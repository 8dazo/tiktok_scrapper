import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { ObjectTracker } from "./object-tracker.js";
import { BaseScraper } from "./base-scraper.js";
import type { FilteredTiktokData, ScraperOptions } from "./types.js";

const baseScraper = new BaseScraper();

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Main scraper: orchestrates ObjectTracker + BaseScraper, writes metadata and optional media files.
 */
export class TTContentScraper extends ObjectTracker {
  private outputDir: string;
  private waitTime: number;
  private clearConsole: boolean;
  private iterTimes: number[] = [];
  private iterTime: number = 0;
  private iterations: number = 0;
  private repeatedError: number = 0;
  private meanIterTime: number = 0;
  private queueEta: string = "0:00:00";
  private nScrapedTotal: number = 0;
  private nErrorsTotal: number = 0;
  private nPending: number = 0;
  private nRetry: number = 0;
  private nTotal: number = 0;

  constructor(options: ScraperOptions = {}) {
    const progressDbPath = options.progressDbPath ?? "progress_tracking/scraping_progress.db";
    super(progressDbPath);
    this.outputDir = options.outputDir ?? "data";
    this.waitTime = options.waitTime ?? 0.35;
    this.clearConsole = options.clearConsole ?? false;
    const outParent = dirname(this.outputDir);
    if (outParent && !existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Scrape all pending objects. Runs until no pending items remain (then throws).
   */
  async scrapePending(options: {
    onlyContent?: boolean;
    onlyUsers?: boolean;
    scrapeFiles?: boolean;
  } = {}): Promise<void> {
    const onlyContent = options.onlyContent ?? false;
    const onlyUsers = options.onlyUsers ?? false;
    const scrapeFiles = options.scrapeFiles ?? false;
    const seedType = onlyContent ? "content" : onlyUsers ? "user" : "all";

    for (;;) {
      const seedlist = this.getPendingObjects(seedType, 100);
      const ids = Object.keys(seedlist);
      if (ids.length === 0) {
        throw new Error(`No more pending objects of type ${seedType} to scrape`);
      }

      for (let i = 0; i < ids.length; i++) {
        this.iterations = i;
        const id = ids[i]!;
        const info = seedlist[id];
        const start = Date.now();
        const objType = info?.type ?? "content";

        if (this.clearConsole) {
          process.stdout.write("\x1b[2J\x1b[H");
        }
        console.info(`Scraping ID: ${id}`);
        this.loggingQueueProgress(seedType);

        if (objType === "user") {
          await this.userActionProtocol(id);
        } else if (objType === "content") {
          await this.contentActionProtocol(id, scrapeFiles);
        }

        this.iterTime = (Date.now() - start) / 1000;
        const waitLeft = Math.max(0, this.waitTime - this.iterTime);
        this.iterTime += waitLeft;
        console.info("Continuing with next ID...\n\n--------");
        await new Promise((r) => setTimeout(r, waitLeft * 1000));
        this.repeatedError = 0;
      }
    }
  }

  private async userActionProtocol(id: string): Promise<void> {
    const userDir = join(this.outputDir, "user_metadata");
    const filepath = join(userDir, `${id}.json`);
    ensureDir(filepath);
    const userData = await baseScraper.scrapeUser(id);
    this.writeMetadataPackage(userData as Record<string, unknown>, filepath);
    this.markCompleted(id, filepath);
    this.nScrapedTotal += 1;
  }

  private async contentActionProtocol(id: string, scrapeFiles: boolean): Promise<void> {
    const contentDir = join(this.outputDir, "content_metadata");
    const filepath = join(contentDir, `${id}.json`);
    ensureDir(filepath);

    let sortedMetadata: FilteredTiktokData;
    let linkToBinaries: { mp4: string | null; mp3: string | null; jpegs: unknown };

    try {
      [sortedMetadata, linkToBinaries] = await baseScraper.scrapeMetadata(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`ID ${id} did not lead to any metadata - ${msg}`);
      this.markError(id, msg);
      this.nErrorsTotal += 1;
      this.nPending -= 1;
      return;
    }

    if (scrapeFiles) {
      const filesDir = join(this.outputDir, "content_files");
      if (!existsSync(filesDir)) mkdirSync(filesDir, { recursive: true });
      try {
        const binaries = await baseScraper.scrapeBinaries(linkToBinaries as Parameters<BaseScraper["scrapeBinaries"]>[0]);
        if (binaries.mp4) {
          (sortedMetadata.file_metadata as { is_slide?: boolean }).is_slide = false;
          const videoPath = join(filesDir, `tiktok_video_${id}.mp4`);
          ensureDir(videoPath);
          writeFileSync(videoPath, binaries.mp4);
        } else if (binaries.jpegs && binaries.jpegs.length > 0) {
          (sortedMetadata.file_metadata as { is_slide?: boolean }).is_slide = true;
          for (let i = 0; i < binaries.jpegs.length; i++) {
            const picturePath = join(filesDir, `tiktok_picture_${id}_${i}.jpeg`);
            ensureDir(picturePath);
            writeFileSync(picturePath, binaries.jpegs[i]);
          }
          if (binaries.mp3) {
            const audioPath = join(filesDir, `tiktok_audio_${id}.mp3`);
            ensureDir(audioPath);
            writeFileSync(audioPath, binaries.mp3);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`ID ${id} binaries failed: ${msg}`);
        this.markError(id, msg);
        this.nErrorsTotal += 1;
        this.nPending -= 1;
        return;
      }
    }

    this.writeMetadataPackage(sortedMetadata as unknown as Record<string, unknown>, filepath);
    this.markCompleted(id, filepath);
    this.nScrapedTotal += 1;
    this.nPending -= 1;
  }

  private loggingQueueProgress(type: string): void {
    if (this.iterations === 0) {
      const stats = this.getStats(type);
      this.nScrapedTotal = stats.completed;
      this.nErrorsTotal = stats.errors;
      this.nPending = stats.pending;
      this.nRetry = stats.retry;
      this.nTotal = this.nScrapedTotal + this.nErrorsTotal + this.nPending + this.nRetry;
    }
    this.iterTimes.unshift(this.iterTime);
    if (this.iterTimes.length > 100) this.iterTimes.pop();
    if (this.iterations % 15 === 0 && this.iterations < 2000) {
      this.meanIterTime = this.iterTimes.reduce((a, b) => a + b, 0) / this.iterTimes.length;
      this.queueEta = formatDuration(Math.round(this.nPending * this.meanIterTime));
    } else if (this.iterations % 501 === 0) {
      this.meanIterTime = this.iterTimes.reduce((a, b) => a + b, 0) / this.iterTimes.length;
      this.queueEta = formatDuration(Math.round(this.nPending * this.meanIterTime));
    }
    if (this.nTotal > 0 || this.nScrapedTotal > 0) {
      console.info(
        `Scraped objects ► ${(this.nScrapedTotal + this.nErrorsTotal).toLocaleString()} / ${this.nTotal.toLocaleString()}`
      );
      console.info(`...minus errors ► ${this.nScrapedTotal.toLocaleString()}`);
    }
    if (this.repeatedError > 0) {
      console.info(`Errors in a row ► ${this.repeatedError}`);
    }
    console.info(`Iteration time ► ${this.iterTime.toFixed(2)} sec.`);
    console.info(`......averaged ► ${this.meanIterTime.toFixed(2)} sec.`);
    console.info(`ETA ► ${this.queueEta}\n↓↓↓`);
  }

  private writeMetadataPackage(metadataPackage: Record<string, unknown>, filename: string): void {
    ensureDir(filename);
    writeFileSync(filename, JSON.stringify(metadataPackage, null, 4), "utf-8");
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
