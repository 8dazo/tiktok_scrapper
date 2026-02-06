# tiktok-api-unofficial (TypeScript)

[![npm version](https://img.shields.io/npm/v/tiktok-api-unofficial.svg)](https://www.npmjs.com/package/tiktok-api-unofficial)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 18+](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)

Unofficial TikTok API library (TypeScript/Node): scrape video and user profile metadata, and optionally download videos, slides, and audio. No official API key required.

## Install

**From npm:**

```bash
npm install tiktok-api-unofficial
```

**From GitHub:**

```bash
git clone https://github.com/YOUR_USERNAME/tiktok_scrapper.git
cd tiktok_scrapper/tiktok-api-ts
npm install
npm run build
```

**Requirements:** Node.js 18+ (for native `fetch`). If you see `Could not locate the bindings file` for `better-sqlite3`, run:

```bash
npm rebuild better-sqlite3
```

## Usage

```ts
import { TTContentScraper } from "tiktok-api-unofficial";

const scraper = new TTContentScraper({
  waitTime: 0.35,
  outputDir: "data/",
  progressDbPath: "progress_tracking/scraping_progress.db",
  clearConsole: false,
});

// Add video IDs (from TikTok URL) and/or usernames
scraper.addObjects(["7398323154424171806"], "batch1", "content");
scraper.addObjects(["tiktok", "tagesschau"], "users", "user");

// Scrape: metadata only, or with media (mp4/jpeg/mp3)
await scraper.scrapePending({ scrapeFiles: false });   // metadata only
// await scraper.scrapePending({ scrapeFiles: true }); // also download videos/slides/audio
```

- **Content:** use `type: "content"` and video IDs from the video URL.
- **Users:** use `type: "user"` and usernames (with or without `@`).

Output is written under `outputDir`:

- `content_metadata/<video_id>.json` – video/post metadata
- `user_metadata/<username>.json` – user profile metadata
- `content_files/` – mp4, jpeg, mp3 when `scrapeFiles: true`

Progress is stored in the SQLite database at `progressDbPath` (pending/completed/error per ID).

## Test

```bash
npm test
```

Runs a metadata-only scrape of 1 video + 1 user and checks output files.

## API (TypeScript)

- **`TTContentScraper`** – Main scraper (extends `ObjectTracker`). Options: `waitTime`, `outputDir`, `progressDbPath`, `clearConsole`.
- **`ObjectTracker`** – SQLite progress DB: `addObject`, `addObjects`, `markCompleted`, `markError`, `getPendingObjects`, `getStats`, `getObjectStatus`, `getErrorObjects`, `resetErrorsToPending`, `resetAllToPending`, `clearAllData`, `close`.
- **`BaseScraper`** – Low-level: `scrapeMetadata(videoId)`, `scrapeUser(username)`, `scrapeBinaries(links)`.
- **`filterTiktokData(raw)`** – Normalize raw TikTok `itemStruct` into typed metadata.
- **`ObjectStatus`** – Enum: `PENDING`, `COMPLETED`, `ERROR`, `RETRY`.

## Publish to npm

1. Log in: `npm login`
2. From `tiktok-api-ts`: `npm publish` (or `npm publish --access public` for a scoped package like `@your-scope/tiktok-api-unofficial`).

If the name `tiktok-api-unofficial` is taken, set a different `name` in `package.json` (e.g. `tiktok-scraper-unofficial` or `@your-username/tiktok-api-unofficial`).

## Push to GitHub

1. Create a new repository on [GitHub](https://github.com/new) (e.g. `tiktok_scrapper`).
2. In your project root:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/tiktok_scrapper.git
   git push -u origin main
   ```
   (Use `master` instead of `main` if your default branch is `master`.)

## License

MIT.
