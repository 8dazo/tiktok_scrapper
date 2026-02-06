/**
 * Quick test: scrape 1 video (metadata) + 1 user, then verify output files.
 * Run from tiktok-api-ts: npm run build && node test-run.mjs
 */
import { TTContentScraper } from "./dist/index.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "test_output");
const progressDb = join(__dirname, "test_progress.db");

async function main() {
  console.log("tiktok-api-ts test: metadata-only scrape (1 video + 1 user)\n");

  const scraper = new TTContentScraper({
    waitTime: 0.35,
    outputDir: outDir,
    progressDbPath: progressDb,
    clearConsole: false,
  });

  scraper.clearAllData();
  scraper.addObjects(["7398323154424171806"], "test", "content");
  scraper.addObjects(["tiktok"], "test", "user");

  // Scrape content first
  console.log("Scraping 1 video (metadata only)...");
  try {
    await scraper.scrapePending({ onlyContent: true, scrapeFiles: false });
  } catch (e) {
    if (!String(e).includes("No more pending")) throw e;
  }

  const contentJson = join(outDir, "content_metadata", "7398323154424171806.json");
  if (!existsSync(contentJson)) {
    throw new Error(`Expected ${contentJson}`);
  }
  const contentData = JSON.parse(readFileSync(contentJson, "utf-8"));
  if (!contentData.video_metadata || !contentData.author_metadata) {
    throw new Error("Expected video_metadata and author_metadata in content JSON");
  }
  console.log("  OK: content_metadata/7398323154424171806.json\n");

  // Scrape user
  console.log("Scraping 1 user...");
  try {
    await scraper.scrapePending({ onlyUsers: true });
  } catch (e) {
    if (!String(e).includes("No more pending")) throw e;
  }

  const userJson = join(outDir, "user_metadata", "tiktok.json");
  if (!existsSync(userJson)) {
    throw new Error(`Expected ${userJson}`);
  }
  const userData = JSON.parse(readFileSync(userJson, "utf-8"));
  const u = userData.user ?? userData;
  if (!u.uniqueId && !u.nickname && !String(u).includes("id")) {
    throw new Error("Expected user info in user JSON");
  }
  console.log("  OK: user_metadata/tiktok.json\n");

  const stats = scraper.getStats("all");
  console.log("Stats:", stats);
  scraper.close();

  if (stats.completed < 2) {
    throw new Error("Expected at least 2 completed (1 content + 1 user)");
  }
  console.log("\nAll checks passed. tiktok-api-ts is working.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
