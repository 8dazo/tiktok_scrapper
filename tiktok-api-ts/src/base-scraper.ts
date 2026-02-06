import * as cheerio from "cheerio";
import type { FilteredTiktokData, LinkToBinaries, RawTiktokDataSlot, ScrapedBinaries } from "./types.js";
import { filterTiktokData } from "./filter.js";

const DEFAULT_HEADERS: Record<string, string> = {
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Cache-Control": "max-age=0",
  Connection: "keep-alive",
  Referer: "https://www.tiktok.com/",
};

function parseCookieHeader(setCookie: string[]): string {
  const pairs: string[] = [];
  for (const line of setCookie) {
    const part = line.split(";")[0].trim();
    if (part) pairs.push(part);
  }
  return pairs.join("; ");
}

/**
 * Base scraper: HTTP requests + TikTok page parsing (video metadata, user profile, binaries).
 */
export class BaseScraper {
  private headers: Record<string, string>;
  private cookieHeader: string = "";

  constructor() {
    this.headers = { ...DEFAULT_HEADERS };
  }

  private async request(url: string, retainCookies: boolean = true): Promise<Response> {
    const headers: Record<string, string> = { ...this.headers };
    if (this.cookieHeader) {
      headers["Cookie"] = this.cookieHeader;
    }
    const response = await fetch(url, { redirect: "follow", headers });
    if (retainCookies && typeof (response.headers as Headers & { getSetCookie?(): string[] }).getSetCookie === "function") {
      const setCookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
      const next = parseCookieHeader(setCookies);
      if (next) {
        this.cookieHeader = this.cookieHeader ? `${this.cookieHeader}; ${next}` : next;
      }
    }
    return response;
  }

  /**
   * Scrape video metadata and binary URLs for one video ID.
   * Returns [filtered metadata, links to mp4/mp3/jpegs].
   */
  async scrapeMetadata(videoId: string): Promise<[FilteredTiktokData, LinkToBinaries]> {
    const url = `https://www.tiktok.com/@tiktok/video/${videoId}`;
    let scriptContent: string | null = null;

    for (let retry = 0; retry < 4; retry++) {
      const response = await this.request(url);
      const html = await response.text();
      const $ = cheerio.load(html);
      const scriptTag = $("#__UNIVERSAL_DATA_FOR_REHYDRATION__");
      if (scriptTag.length && scriptTag.html()) {
        scriptContent = scriptTag.html();
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!scriptContent) {
      throw new Error("__UNIVERSAL_DATA_FOR_REHYDRATION__ not in response");
    }

    const data = JSON.parse(scriptContent) as {
      __DEFAULT_SCOPE__?: {
        "webapp.video-detail"?: {
          itemInfo?: { itemStruct?: RawTiktokDataSlot };
        };
      };
    };
    const itemStruct =
      data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    if (!itemStruct) {
      throw new Error("itemStruct not found in rehydration data");
    }

    const sortedMetadata = filterTiktokData(itemStruct);
    const imagePost = itemStruct.imagePost as { images?: Array<{ imageURL?: { urlList?: string[] } }> } | undefined;
    const music = itemStruct.music as { playUrl?: string } | undefined;
    const video = itemStruct.video as { playAddr?: string; downloadAddr?: string } | undefined;
    const imagesBinaries = imagePost?.images ?? null;
    const audioAddr = music?.playUrl ?? null;
    let videoAddr = video?.playAddr ?? null;
    if (videoAddr === "") {
      videoAddr = video?.downloadAddr ?? null;
    }

    const linkToBinaries: LinkToBinaries = {
      mp4: videoAddr ?? null,
      mp3: audioAddr ?? null,
      jpegs: imagesBinaries ?? null,
    };

    return [sortedMetadata, linkToBinaries];
  }

  /**
   * Scrape user profile metadata by username.
   */
  async scrapeUser(username: string): Promise<Record<string, unknown>> {
    const clean = username.replace(/^@/, "");
    const url = `https://www.tiktok.com/@${clean}`;
    const response = await this.request(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    const rehydration = $("#__UNIVERSAL_DATA_FOR_REHYDRATION__");
    const content = rehydration.html();
    if (!content) {
      throw new Error("__UNIVERSAL_DATA_FOR_REHYDRATION__ not found on user page");
    }
    const data = JSON.parse(content) as {
      __DEFAULT_SCOPE__?: {
        "webapp.user-detail"?: { userInfo?: Record<string, unknown> };
      };
    };
    const userInfo = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo;
    if (!userInfo) {
      throw new Error("userInfo not found in rehydration data");
    }
    return userInfo;
  }

  /**
   * Download binaries (mp4, mp3, jpegs) from links returned by scrapeMetadata.
   */
  async scrapeBinaries(links: LinkToBinaries): Promise<ScrapedBinaries> {
    const result: ScrapedBinaries = { mp3: null, mp4: null, jpegs: [] };
    const maxRetries = 4;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (links.mp3) {
          result.mp3 = await this.fetchBinary(links.mp3, "audio");
        }
        if (links.mp4) {
          result.mp4 = await this.fetchBinary(links.mp4, "video");
        }
        if (links.jpegs && links.jpegs.length > 0) {
          result.jpegs = [];
          for (const img of links.jpegs) {
            const url = img?.imageURL?.urlList?.[0];
            if (url) {
              result.jpegs.push(await this.fetchBinary(url, "image"));
            }
          }
        }
        return result;
      } catch (e) {
        if (attempt === maxRetries - 1) {
          throw new Error(`Failed to download binaries after retries: ${e}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return result;
  }

  private async fetchBinary(url: string, kind: "video" | "audio" | "image"): Promise<Buffer> {
    const response = await this.request(url, false);
    if (response.status === 403) {
      if (kind === "video") {
        const altUrl = url.replace("=tt_chain_token", "");
        const alt = await this.request(altUrl, false);
        if (alt.status === 403) throw new Error("403 on video URL");
        const buf = Buffer.from(await alt.arrayBuffer());
        return buf;
      }
      throw new Error(`403 on ${kind} URL`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    return buf;
  }
}
