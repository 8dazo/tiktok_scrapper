#!/usr/bin/env python3
"""
tiktok-api – Unofficial TikTok API library (single-file).

Fetch video/post metadata, user profile metadata, and optionally download
videos, slides, and audio. No official API key required.

Usage:
    from tiktok_api import TT_Content_Scraper

    scraper = TT_Content_Scraper(
        wait_time=0.35,
        output_files_fp="data/",
        progress_file_fn="progress_tracking/scraping_progress.db",
        clear_console=False,
    )
    scraper.add_objects(ids=["7398323154424171806"], title="batch1", type="content")
    scraper.add_objects(ids=["tagesschau"], title="users", type="user")
    scraper.scrape_pending(scrape_files=False)  # or scrape_files=True for mp4/jpeg/mp3

Dependencies: pip install requests beautifulsoup4 browser_cookie3
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import ssl
import statistics
import time
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup

try:
    import browser_cookie3
except ImportError:
    browser_cookie3 = None

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s;%(levelname)-5s:%(name)-10s: %(message)s",
    datefmt="%m-%d/%H:%M",
    force=True,
)
logger = logging.getLogger("TTCS")
logger_db = logging.getLogger("TTCS.ObjTracker")
logger_base = logging.getLogger("TTCS.Base")


# ---------------------------------------------------------------------------
# Object tracker (SQLite progress DB)
# ---------------------------------------------------------------------------
class ObjectStatus(Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    ERROR = "error"
    RETRY = "retry"


class ObjectTracker:
    """SQLite database that tracks pending/completed/error status per object (video id or username)."""

    def __init__(self, db_file: str = "progress_tracking/scraping_progress.db") -> None:
        Path(db_file).parent.mkdir(parents=True, exist_ok=True)
        self.db_file = db_file
        self.conn = None
        self._connect()
        self._create_tables()
        self._create_indexes()

    def _connect(self) -> None:
        try:
            self.conn = sqlite3.connect(self.db_file, check_same_thread=False)
            self.conn.execute("PRAGMA foreign_keys = ON")
            self.conn.execute("PRAGMA journal_mode = WAL")
            self.conn.execute("PRAGMA synchronous = NORMAL")
            logger_db.info(f"Connected to SQLite database: {self.db_file}")
        except sqlite3.Error as e:
            logger_db.error(f"Error connecting to database: {e}")
            raise

    def _create_tables(self) -> None:
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS objects (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                title TEXT,
                type TEXT,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                attempts INTEGER DEFAULT 0,
                last_error TEXT,
                last_attempt TIMESTAMP,
                file_path TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        self.conn.execute("""
            CREATE TRIGGER IF NOT EXISTS update_timestamp
            AFTER UPDATE ON objects
            BEGIN
                UPDATE objects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;
        """)
        self.conn.commit()
        logger_db.info("Database tables created successfully")

    def _create_indexes(self) -> None:
        for sql in [
            "CREATE INDEX IF NOT EXISTS idx_status ON objects(status)",
            "CREATE INDEX IF NOT EXISTS idx_added_at ON objects(added_at)",
            "CREATE INDEX IF NOT EXISTS idx_completed_at ON objects(completed_at)",
        ]:
            self.conn.execute(sql)
        self.conn.commit()
        logger_db.info("Database indexes created successfully")

    def add_object(self, id: str, title: Optional[str] = None, type: Optional[str] = None) -> None:
        self.conn.execute(
            """
            INSERT OR IGNORE INTO objects (id, status, title, type, added_at, attempts)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (id, ObjectStatus.PENDING.value, title, type, datetime.now().isoformat()),
        )
        self.conn.commit()

    def add_objects(
        self, ids: List[str], title: Optional[str] = None, type: Optional[str] = None
    ) -> None:
        current_time = datetime.now().isoformat()
        rows = [(i, ObjectStatus.PENDING.value, title, type, current_time, 0) for i in ids]
        self.conn.executemany(
            """
            INSERT OR IGNORE INTO objects (id, status, title, type, added_at, attempts)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        self.conn.commit()
        logger_db.info(f"Added {len(ids)} objects to tracker")

    def mark_completed(self, id: str, file_path: Optional[str] = None) -> None:
        self.conn.execute(
            """
            UPDATE objects SET status = ?, completed_at = ?, file_path = ? WHERE id = ?
            """,
            (ObjectStatus.COMPLETED.value, datetime.now().isoformat(), file_path, id),
        )
        self.conn.commit()

    def mark_error(self, id: str, error_message: str) -> None:
        cursor = self.conn.execute("SELECT attempts FROM objects WHERE id = ?", (id,))
        result = cursor.fetchone()
        attempts = (result[0] + 1) if result else 1
        self.conn.execute(
            """
            UPDATE objects SET status = ?, attempts = ?, last_error = ?, last_attempt = ?
            WHERE id = ?
            """,
            (ObjectStatus.ERROR.value, attempts, error_message, datetime.now().isoformat(), id),
        )
        self.conn.commit()

    def get_pending_objects(self, type: str = "all", limit: int = 10**10) -> Dict[str, Dict[str, Any]]:
        if type == "all":
            cursor = self.conn.execute(
                """
                SELECT id, title, type FROM objects WHERE status IN (?, ?) LIMIT ?
                """,
                (ObjectStatus.PENDING.value, ObjectStatus.RETRY.value, limit),
            )
        else:
            cursor = self.conn.execute(
                """
                SELECT id, title, type FROM objects WHERE status IN (?, ?) AND type = ? LIMIT ?
                """,
                (ObjectStatus.PENDING.value, ObjectStatus.RETRY.value, type, limit),
            )
        return {row[0]: {"title": row[1], "type": row[2]} for row in cursor.fetchall()}

    def get_stats(self, type: str = "all") -> Dict[str, int]:
        if type == "all":
            cursor = self.conn.execute(
                "SELECT status, COUNT(*) FROM objects GROUP BY status"
            )
        else:
            cursor = self.conn.execute(
                "SELECT status, COUNT(*) FROM objects WHERE type = ? GROUP BY status",
                (type,),
            )
        stats = {"completed": 0, "errors": 0, "pending": 0, "retry": 0}
        for status, count in cursor.fetchall():
            if status == ObjectStatus.COMPLETED.value:
                stats["completed"] = count
            elif status == ObjectStatus.ERROR.value:
                stats["errors"] = count
            elif status == ObjectStatus.PENDING.value:
                stats["pending"] = count
            elif status == ObjectStatus.RETRY.value:
                stats["retry"] = count
        return stats

    def get_object_status(self, id: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT status, title, type, added_at, completed_at, attempts, last_error, last_attempt, file_path
            FROM objects WHERE id = ?
            """,
            (id,),
        )
        result = cursor.fetchone()
        if not result:
            return None
        return {
            "status": result[0],
            "title": result[1],
            "type": result[2],
            "added_at": result[3],
            "completed_at": result[4],
            "attempts": result[5],
            "last_error": result[6],
            "last_attempt": result[7],
            "file_path": result[8],
        }

    def get_error_objects(self) -> Dict[str, Dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT id, title, type, added_at, attempts, last_error, last_attempt, file_path
            FROM objects WHERE status = ? ORDER BY last_attempt DESC
            """,
            (ObjectStatus.ERROR.value,),
        )
        return {
            row[0]: {
                "status": ObjectStatus.ERROR.value,
                "title": row[1],
                "type": row[2],
                "added_at": row[3],
                "attempts": row[4],
                "last_error": row[5],
                "last_attempt": row[6],
                "file_path": row[7],
                "completed_at": None,
            }
            for row in cursor.fetchall()
        }

    def reset_errors_to_pending(self) -> int:
        cursor = self.conn.execute(
            """
            UPDATE objects SET status = ?, last_error = NULL, last_attempt = NULL WHERE status = ?
            """,
            (ObjectStatus.PENDING.value, ObjectStatus.ERROR.value),
        )
        self.conn.commit()
        logger_db.info(f"Reset {cursor.rowcount} error objects to pending")
        return cursor.rowcount

    def reset_all_to_pending(self) -> int:
        cursor = self.conn.execute(
            "UPDATE objects SET status = 'pending', last_error = NULL, last_attempt = NULL"
        )
        self.conn.commit()
        logger_db.info(f"Reset {cursor.rowcount} objects to pending")
        return cursor.rowcount

    def clear_all_data(self) -> None:
        self.conn.execute("DELETE FROM objects")
        self.conn.execute("DELETE FROM metadata")
        self.conn.commit()
        logger_db.info("All tracking data cleared")

    def close(self) -> None:
        if self.conn:
            self.conn.close()
            logger_db.info("Database connection closed")

    def __enter__(self) -> ObjectTracker:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ---------------------------------------------------------------------------
# TikTok data filter (raw JSON -> structured metadata)
# ---------------------------------------------------------------------------
def _force_to_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _prep_hashtags_and_mentions(data_slot: Dict) -> tuple:
    text_elements = data_slot.get("textExtra", None)
    challenges = data_slot.get("challenges", None) or []
    hashtags_metadata = []
    mentions_list = []
    if text_elements:
        for element in text_elements:
            mention = element.get("userId", None)
            if mention is None:
                hashtag_data = {
                    "name": element.get("hashtagName"),
                    "id": _force_to_int(element.get("hashtagId")),
                    "type": element.get("type"),
                    "sub_type": element.get("subType"),
                    "is_commerce": element.get("isCommerce"),
                }
                matching = [c for c in challenges if _force_to_int(c.get("id")) == hashtag_data["id"]]
                hashtag_data["description"] = matching[0]["desc"] if matching else None
                hashtags_metadata.append(hashtag_data)
            else:
                mentions_list.append(mention)
    return hashtags_metadata, mentions_list


def _filter_tiktok_data(data_slot: Dict) -> Dict:
    hashtags_metadata, mentions_list = _prep_hashtags_and_mentions(data_slot)
    create_time = data_slot.get("createTime")
    video_metadata = {
        "id": _force_to_int(data_slot.get("id")),
        "time_created": datetime.fromtimestamp(int(create_time)).isoformat() if create_time else None,
        "author_id": _force_to_int(data_slot.get("author", {}).get("id")),
        "description": data_slot.get("desc"),
        "hashtags": [h["name"] for h in hashtags_metadata],
        "mentions": mentions_list if mentions_list else None,
        "music_id": _force_to_int(data_slot.get("music", {}).get("id")),
        "schedule_time": data_slot.get("scheduleTime"),
        "location_created": data_slot.get("locationCreated"),
        "is_ad": data_slot.get("isAd", False),
        "suggested_words": data_slot.get("suggestedWords"),
        "warn_info": data_slot.get("warnInfo"),
        "original_item": data_slot.get("originalItem"),
        "offical_item": data_slot.get("officalItem"),
        "secret": data_slot.get("secret"),
        "for_friend": data_slot.get("forFriend"),
        "digged": data_slot.get("digged"),
        "item_comment_status": data_slot.get("itemCommentStatus"),
        "take_down": data_slot.get("takeDown"),
        "effect_stickers": data_slot.get("effectStickers"),
        "private_item": data_slot.get("privateItem"),
        "duet_enabled": data_slot.get("duetEnabled", False),
        "stitch_enabled": data_slot.get("stitchEnabled", False),
        "stickers_on_item": data_slot.get("stickersOnItem"),
        "share_enabled": data_slot.get("shareEnabled"),
        "comments": data_slot.get("comments"),
        "duet_display": data_slot.get("duetDisplay"),
        "stitch_display": data_slot.get("stitchDisplay"),
        "index_enabled": data_slot.get("indexEnabled", False),
        "diversification_labels": data_slot.get("diversificationLabels"),
        "diversification_id": data_slot.get("diversificationId"),
        "channel_tags": data_slot.get("channelTags"),
        "keyword_tags": data_slot.get("keywordTags"),
        "is_ai_gc": data_slot.get("IsAigc"),
        "aigc_label_type": data_slot.get("aigcLabelType"),
        "ai_gc_description": data_slot.get("AIGCDescription"),
    }
    if video_metadata["location_created"] and len(video_metadata["location_created"]) > 2:
        video_metadata["location_created"] = "XX" if video_metadata["location_created"] == "FAKE-AD" else None
    if video_metadata["suggested_words"] is not None and len(video_metadata["suggested_words"]) == 0:
        video_metadata["suggested_words"] = None
    for k in ("warn_info", "effect_stickers", "stickers_on_item", "comments", "channel_tags", "diversification_labels"):
        if video_metadata.get(k) == {} or video_metadata.get(k) == []:
            video_metadata[k] = None
    if video_metadata.get("ai_gc_description") == "":
        video_metadata["ai_gc_description"] = None

    stats_data = data_slot.get("statsV2") or data_slot.get("stats", {})
    video_metadata["diggcount"] = _force_to_int(stats_data.get("diggCount"))
    video_metadata["sharecount"] = _force_to_int(stats_data.get("shareCount"))
    video_metadata["commentcount"] = _force_to_int(stats_data.get("commentCount"))
    video_metadata["playcount"] = _force_to_int(stats_data.get("playCount"))
    video_metadata["collectcount"] = _force_to_int(stats_data.get("collectCount"))
    video_metadata["repostcount"] = _force_to_int(stats_data.get("repostCount"))

    video = data_slot.get("video", {})
    file_metadata = {
        "id": video_metadata["id"],
        "filepath": None,
        "duration": video.get("duration"),
        "height": video.get("height"),
        "width": video.get("width"),
        "ratio": video.get("ratio"),
        "volume_loudness": video.get("volumeInfo", {}).get("Loudness"),
        "volume_peak": video.get("volumeInfo", {}).get("Peak"),
        "has_original_audio": video.get("claInfo", {}).get("hasOriginalAudio"),
        "enable_audio_caption": video.get("claInfo", {}).get("enableAutoCaption"),
        "no_caption_reason": video.get("claInfo", {}).get("noCaptionReason"),
    }
    if file_metadata["ratio"]:
        try:
            file_metadata["ratio"] = int(str(file_metadata["ratio"]).rstrip("p"))
        except (ValueError, TypeError):
            file_metadata["ratio"] = None

    music = data_slot.get("music", {})
    music_metadata = {
        "id": video_metadata["music_id"],
        "title": music.get("title"),
        "author_name": music.get("authorName"),
        "original": music.get("original"),
        "schedule_search_time": music.get("scheduleSearchTime"),
        "collected": music.get("collected"),
        "precise_duration": music.get("preciseDuration"),
    }

    author = data_slot.get("author", {})
    author_metadata = {
        "id": _force_to_int(author.get("id")),
        "username": author.get("uniqueId"),
        "name": author.get("nickname"),
        "signature": author.get("signature"),
        "create_time": author.get("createTime"),
        "verified": author.get("verified"),
        "ftc": author.get("ftc"),
        "relation": author.get("relation"),
        "open_favorite": author.get("openFavorite"),
        "comment_setting": author.get("commentSetting"),
        "duet_setting": author.get("duetSetting"),
        "stitch_setting": author.get("stitchSetting"),
        "private_account": author.get("privateAccount"),
        "secret": author.get("secret"),
        "is_ad_virtual": author.get("isADVirtual"),
        "download_setting": author.get("downloadSetting"),
        "recommend_reason": author.get("recommendReason"),
        "suggest_account_bind": author.get("suggestAccountBind"),
    }

    return {
        "video_metadata": video_metadata,
        "file_metadata": file_metadata,
        "music_metadata": music_metadata,
        "author_metadata": author_metadata,
        "hashtags_metadata": hashtags_metadata,
    }


# ---------------------------------------------------------------------------
# Base scraper (HTTP + TikTok page parsing)
# ---------------------------------------------------------------------------
class BaseScraper:
    def __init__(self, browser_name: Optional[str] = None) -> None:
        self.headers = {
            "Accept-Encoding": "gzip, deflate, sdch",
            "Accept-Language": "en-US,en;q=0.8",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Cache-Control": "max-age=0",
            "Connection": "keep-alive",
            "referer": "https://www.tiktok.com/",
        }
        self.cookies = {}
        if browser_name and browser_cookie3:
            try:
                self.cookies = getattr(browser_cookie3, browser_name)(domain_name=".tiktok.com")
            except Exception:
                pass

    def request_and_retain_cookies(self, url: str, retain: bool = True) -> requests.Response:
        response = requests.get(
            url,
            allow_redirects=True,
            headers=self.headers,
            cookies=self.cookies,
            timeout=20,
            stream=False,
        )
        if retain:
            self.cookies = response.cookies
        return response

    def scrape_metadata(self, video_id: str) -> tuple:
        script_tag = None
        for retries in range(4):
            response = self.request_and_retain_cookies(
                url=f"https://www.tiktok.com/@tiktok/video/{video_id}"
            )
            soup = BeautifulSoup(response.text, "html.parser")
            script_tag = soup.find("script", id="__UNIVERSAL_DATA_FOR_REHYDRATION__")
            if script_tag is not None:
                break
            time.sleep(0.1)
        if script_tag is None:
            raise KeyError("__UNIVERSAL_DATA_FOR_REHYDRATION__ not in response")
        data = json.loads(script_tag.string)
        metadata = data["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"]
        sorted_metadata = _filter_tiktok_data(metadata)
        images_binaries_addr = (metadata.get("imagePost") or {}).get("images")
        audio_binary_addr = (metadata.get("music") or {}).get("playUrl")
        video_binary_addr = (metadata.get("video") or {}).get("playAddr")
        if video_binary_addr == "":
            video_binary_addr = (metadata.get("video") or {}).get("downloadAddr")
        link_to_binaries = {"mp4": video_binary_addr, "mp3": audio_binary_addr, "jpegs": images_binaries_addr}
        return sorted_metadata, link_to_binaries

    def scrape_user(self, username: str) -> Dict:
        if "@" in username:
            username = username.replace("@", "")
        response = self.request_and_retain_cookies(url=f"https://www.tiktok.com/@{username}")
        soup = BeautifulSoup(response.text, "html.parser")
        rehydration = soup.find("script", attrs={"id": "__UNIVERSAL_DATA_FOR_REHYDRATION__"})
        data = json.loads(rehydration.string)
        return data["__DEFAULT_SCOPE__"]["webapp.user-detail"]["userInfo"]

    def scrape_binaries(self, links: Dict) -> Dict:
        audio_binary = None
        video_binary = None
        picture_content_binary = None
        for retries in range(4):
            try:
                if links.get("mp3"):
                    audio_binary = self._scrape_audio(links["mp3"])
                if links.get("mp4"):
                    video_binary = self._scrape_video(links["mp4"])
                if links.get("jpegs"):
                    metadata_images = links["jpegs"]
                    logger_base.info("-> is slide with {} pictures".format(len(metadata_images)))
                    picture_content_binary = []
                    for i in range(len(metadata_images)):
                        url = metadata_images[i]["imageURL"]["urlList"][0]
                        picture_content_binary.append(self._scrape_picture(url))
                return {"mp3": audio_binary, "mp4": video_binary, "jpegs": picture_content_binary or []}
            except (
                requests.exceptions.ChunkedEncodingError,
                ConnectionError,
                requests.exceptions.ReadTimeout,
                requests.exceptions.ConnectionError,
                ssl.SSLError,
                requests.exceptions.SSLError,
            ) as e:
                logger_base.warning(f"{e} - retrying (attempt {retries + 1}/4)")
                time.sleep(0.1)
        raise ConnectionError("Failed to download binaries after retries")

    def _scrape_video(self, url: str) -> bytes:
        r = self.request_and_retain_cookies(url, retain=False)
        if r.status_code == 403 or not r:
            url = url.replace("=tt_chain_token", "")
            r = self.request_and_retain_cookies(url, retain=False)
        if r.status_code == 403:
            raise ConnectionError("403 on video URL")
        return r.content

    def _scrape_picture(self, url: str) -> bytes:
        r = self.request_and_retain_cookies(url, retain=False)
        if r.status_code == 403:
            raise ConnectionError("403 on image URL")
        return r.content

    def _scrape_audio(self, url: str) -> bytes:
        r = self.request_and_retain_cookies(url, retain=False)
        if r.status_code == 403:
            raise ConnectionError("403 on audio URL")
        return r.content


# ---------------------------------------------------------------------------
# Main scraper (orchestrator: tracker + base scraper + file writing)
# ---------------------------------------------------------------------------
_base_scraper = BaseScraper()


class TT_Content_Scraper(ObjectTracker):
    def __init__(
        self,
        wait_time: float = 0.35,
        output_files_fp: str = "data/",
        progress_file_fn: str = "progress_tracking/scraping_progress.db",
        clear_console: bool = False,
        browser_name: Optional[str] = None,
    ) -> None:
        super().__init__(progress_file_fn)
        Path(output_files_fp).mkdir(parents=True, exist_ok=True)
        self.output_files_fp = output_files_fp
        self.WAIT_TIME = wait_time
        self.iter_times: List[float] = []
        self.ITER_TIME = 0.0
        self.iterations = 0
        self.repeated_error = 0
        self.clear_console = clear_console
        self.mean_iter_time = 0.0
        self.queue_eta = "0:00:00"
        self.n_scraped_total = 0
        self.n_errors_total = 0
        self.n_pending = 0
        self.n_retry = 0
        self.n_total = 0
        logger.info("Scraper Initialized\n***")

    def scrape_pending(
        self,
        only_content: bool = False,
        only_users: bool = False,
        scrape_files: bool = False,
    ) -> None:
        seed_type = "content" if only_content else ("user" if only_users else "all")
        while True:
            seedlist = self.get_pending_objects(type=seed_type, limit=100)
            if len(seedlist) == 0:
                raise AssertionError(f"No more pending objects of type {seed_type} to scrape")
            for self.iterations, (id, info) in enumerate(seedlist.items()):
                start = time.time()
                obj_type = info["type"]
                if self.clear_console:
                    os.system("clear" if os.name != "nt" else "cls")
                logger.info(f"Scraping ID: {id}")
                self._logging_queue_progress(type=seed_type)
                if obj_type == "user":
                    self._user_action_protocol(id)
                elif obj_type == "content":
                    self._content_action_protocol(id, scrape_files)
                stop = time.time()
                self.ITER_TIME = stop - start
                wait_left = max(0.0, self.WAIT_TIME - self.ITER_TIME)
                self.ITER_TIME += wait_left
                logger.info("Continuing with next ID...\n\n--------")
                time.sleep(wait_left)
                self.repeated_error = 0

    def _user_action_protocol(self, id: str) -> None:
        filepath = os.path.join(self.output_files_fp, "user_metadata", f"{id}.json")
        Path(self.output_files_fp, "user_metadata").mkdir(parents=True, exist_ok=True)
        user_data = _base_scraper.scrape_user(id)
        self._write_metadata_package(user_data, filepath)
        self.mark_completed(id, filepath)
        self.n_scraped_total += 1

    def _content_action_protocol(self, id: str, scrape_files: bool) -> None:
        filepath = os.path.join(self.output_files_fp, "content_metadata", f"{id}.json")
        Path(self.output_files_fp, "content_metadata").mkdir(parents=True, exist_ok=True)
        try:
            sorted_metadata, link_to_binaries = _base_scraper.scrape_metadata(id)
        except KeyError as e:
            logger.warning(f"ID {id} did not lead to any metadata - KeyError {e}")
            self.mark_error(id, str(e))
            self.n_errors_total += 1
            self.n_pending -= 1
            return
        if scrape_files:
            Path(self.output_files_fp, "content_files").mkdir(parents=True, exist_ok=True)
            try:
                binaries = _base_scraper.scrape_binaries(link_to_binaries)
            except ConnectionError as e:
                logger.warning(f"ID {id} binaries failed: {e}")
                self.mark_error(id, str(e))
                self.n_errors_total += 1
                self.n_pending -= 1
                return
            if binaries.get("mp4"):
                sorted_metadata["file_metadata"]["is_slide"] = False
                self._write_video(
                    binaries["mp4"],
                    Path(self.output_files_fp, "content_files", f"tiktok_video_{id}.mp4"),
                )
            elif binaries.get("jpegs"):
                sorted_metadata["file_metadata"]["is_slide"] = True
                for i, jpeg in enumerate(binaries["jpegs"]):
                    self._write_pictures(
                        jpeg,
                        Path(self.output_files_fp, "content_files", f"tiktok_picture_{id}_{i}.jpeg"),
                    )
                if binaries.get("mp3"):
                    self._write_audio(
                        binaries["mp3"],
                        Path(self.output_files_fp, "content_files", f"tiktok_audio_{id}.mp3"),
                    )
        self._write_metadata_package(sorted_metadata, filepath)
        self.mark_completed(id, filepath)
        self.n_scraped_total += 1
        self.n_pending -= 1

    def _logging_queue_progress(self, type: str) -> None:
        if self.iterations == 0:
            stats = self.get_stats(type)
            self.n_scraped_total = stats["completed"]
            self.n_errors_total = stats["errors"]
            self.n_pending = stats["pending"]
            self.n_retry = stats["retry"]
            self.n_total = self.n_scraped_total + self.n_errors_total + self.n_pending + self.n_retry
        self.iter_times.insert(0, self.ITER_TIME)
        if len(self.iter_times) > 100:
            self.iter_times.pop()
        if self.iterations % 15 == 0 and self.iterations < 2_000:
            self.mean_iter_time = statistics.mean(self.iter_times)
            self.queue_eta = str(timedelta(seconds=int(self.n_pending * self.mean_iter_time)))
        elif self.iterations % 501 == 0:
            self.mean_iter_time = statistics.mean(self.iter_times)
            self.queue_eta = str(timedelta(seconds=int(self.n_pending * self.mean_iter_time)))
        if self.n_total > 0 or self.n_scraped_total > 0:
            logger.info(f"Scraped objects ► {self.n_scraped_total + self.n_errors_total:,} / {self.n_total:,}")
            logger.info(f"...minus errors ► {self.n_scraped_total:,}")
        if self.repeated_error > 0:
            logger.info(f"Errors in a row ► {self.repeated_error}")
        logger.info("Iteration time ► " + str(round(self.ITER_TIME, 2)) + " sec.")
        logger.info("......averaged ► " + str(round(self.mean_iter_time, 2)) + " sec.")
        logger.info(f"ETA ► {self.queue_eta}\n↓↓↓")

    def _write_metadata_package(self, metadata_package: Dict, filename: str) -> None:
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(metadata_package, f, ensure_ascii=False, indent=4)
        logger.debug(f"▼ JSON saved to {filename}")

    def _write_video(self, video_content: bytes, filename: Path) -> None:
        with open(filename, "wb") as f:
            f.write(video_content)
        logger.debug(f"▼ MP4 saved to {filename}")

    def _write_pictures(self, picture_content: bytes, filename: Path) -> None:
        with open(filename, "wb") as f:
            f.write(picture_content)
        logger.debug(f"▼ JPEG saved to {filename}")

    def _write_audio(self, audio_content: bytes, filename: Path) -> None:
        with open(filename, "wb") as f:
            f.write(audio_content)
        logger.debug(f"▼ MP3 saved to {filename}")


# ---------------------------------------------------------------------------
# Entry point / example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    scraper = TT_Content_Scraper(
        wait_time=0.35,
        output_files_fp="data/",
        progress_file_fn="progress_tracking/scraping_progress.db",
        clear_console=False,
    )
    scraper.clear_all_data()
    scraper.add_objects(ids=["7398323154424171806"], title="example", type="content")
    print("Starting scrape (metadata only)...")
    try:
        scraper.scrape_pending(only_content=True, scrape_files=False)
    except AssertionError as e:
        if "No more pending" in str(e):
            print("Done. Check data/content_metadata/ for JSON.")
        else:
            raise
