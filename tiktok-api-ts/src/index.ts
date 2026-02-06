/**
 * tiktok-api-unofficial – Unofficial TikTok API library (TypeScript/Node).
 *
 * Fetch video/post metadata, user profile metadata, and optionally download
 * videos, slides, and audio. No official API key required.
 *
 * @example
 * ```ts
 * import { TTContentScraper } from "tiktok-api-unofficial";
 *
 * const scraper = new TTContentScraper({
 *   waitTime: 0.35,
 *   outputDir: "data/",
 *   progressDbPath: "progress_tracking/scraping_progress.db",
 *   clearConsole: false,
 * });
 * scraper.addObjects(["7398323154424171806"], "batch1", "content");
 * scraper.addObjects(["tiktok"], "users", "user");
 * await scraper.scrapePending({ scrapeFiles: false });
 * ```
 */

export { ObjectStatus, ObjectTracker } from "./object-tracker.js";
export { filterTiktokData } from "./filter.js";
export { BaseScraper } from "./base-scraper.js";
export { TTContentScraper } from "./content-scraper.js";

export type {
  ObjectInfo,
  ObjectStatusResult,
  TrackerStats,
  ErrorObjectInfo,
  RawTiktokDataSlot,
  VideoMetadata,
  FileMetadata,
  MusicMetadata,
  AuthorMetadata,
  HashtagMetadata,
  FilteredTiktokData,
  LinkToBinaries,
  ScrapedBinaries,
  ScraperOptions,
} from "./types.js";
