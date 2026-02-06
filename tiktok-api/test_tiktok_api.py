#!/usr/bin/env python3
"""
Test script for tiktok-api library.
Runs a quick metadata-only scrape (1 video + 1 user) and checks output.

Run from tiktok-api/ with deps installed:
  pip install -e .   # or: pip install requests beautifulsoup4 browser_cookie3
  python test_tiktok_api.py
"""
import os
import sys
from pathlib import Path

# Ensure we can import tiktok_api from this directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from tiktok_api import TT_Content_Scraper, ObjectTracker, ObjectStatus


def main():
    out_dir = Path(__file__).parent / "test_output"
    progress_db = Path(__file__).parent / "test_progress.db"

    print("tiktok-api test: metadata-only scrape (1 video + 1 user)")
    print("Output dir:", out_dir)
    print()

    scraper = TT_Content_Scraper(
        wait_time=0.35,
        output_files_fp=str(out_dir),
        progress_file_fn=str(progress_db),
        clear_console=False,
    )

    scraper.clear_all_data()
    scraper.add_objects(ids=["7398323154424171806"], title="test", type="content")
    scraper.add_objects(ids=["tiktok"], title="test", type="user")

    # Scrape content only first
    print("Scraping 1 video (metadata only)...")
    try:
        scraper.scrape_pending(only_content=True, scrape_files=False)
    except AssertionError as e:
        if "No more pending" not in str(e):
            raise
    content_json = out_dir / "content_metadata" / "7398323154424171806.json"
    assert content_json.exists(), f"Expected {content_json}"
    with open(content_json, encoding="utf-8") as f:
        data = __import__("json").load(f)
    assert "video_metadata" in data and "author_metadata" in data
    print("  OK: content_metadata/7398323154424171806.json exists and has video_metadata, author_metadata")

    # Scrape user
    print("Scraping 1 user...")
    try:
        scraper.scrape_pending(only_users=True)
    except AssertionError as e:
        if "No more pending" not in str(e):
            raise
    user_json = out_dir / "user_metadata" / "tiktok.json"
    assert user_json.exists(), f"Expected {user_json}"
    with open(user_json, encoding="utf-8") as f:
        user_data = __import__("json").load(f)
    # API returns nested {"user": {...}} or flat user fields
    if "user" in user_data:
        u = user_data["user"]
    else:
        u = user_data
    assert "uniqueId" in u or "nickname" in u or "id" in str(u)
    print("  OK: user_metadata/tiktok.json exists and has user info")

    # Stats
    stats = scraper.get_stats("all")
    print()
    print("Stats:", stats)
    assert stats["completed"] >= 2, "Expected at least 2 completed (1 content + 1 user)"

    print()
    print("All checks passed. tiktok-api is working.")


if __name__ == "__main__":
    main()
