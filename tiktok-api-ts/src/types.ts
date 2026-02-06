/**
 * Object status in the progress tracker.
 */
export enum ObjectStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  ERROR = "error",
  RETRY = "retry",
}

export interface ObjectInfo {
  title: string | null;
  type: string | null;
}

export interface ObjectStatusResult {
  status: string;
  title: string | null;
  type: string | null;
  added_at: string | null;
  completed_at: string | null;
  attempts: number;
  last_error: string | null;
  last_attempt: string | null;
  file_path: string | null;
}

export interface TrackerStats {
  completed: number;
  errors: number;
  pending: number;
  retry: number;
}

export interface ErrorObjectInfo extends ObjectInfo {
  status: string;
  added_at: string | null;
  attempts: number;
  last_error: string | null;
  last_attempt: string | null;
  file_path: string | null;
  completed_at: null;
}

/** Raw TikTok itemStruct / API shapes (partial). */
export interface RawTiktokDataSlot {
  id?: string | number;
  createTime?: string | number;
  author?: Record<string, unknown>;
  desc?: string;
  textExtra?: Array<{ userId?: string; hashtagName?: string; hashtagId?: string | number; type?: string; subType?: string; isCommerce?: boolean }>;
  challenges?: Array<{ id?: string | number; desc?: string }>;
  music?: Record<string, unknown>;
  video?: Record<string, unknown>;
  imagePost?: { images?: Array<{ imageURL?: { urlList?: string[] } }> };
  statsV2?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VideoMetadata {
  id: number | null;
  time_created: string | null;
  author_id: number | null;
  description: string | null;
  hashtags: string[];
  mentions: string[] | null;
  music_id: number | null;
  schedule_time: unknown;
  location_created: string | null;
  is_ad: boolean;
  suggested_words: unknown;
  warn_info: unknown;
  original_item: unknown;
  offical_item: unknown;
  secret: unknown;
  for_friend: unknown;
  digged: unknown;
  item_comment_status: unknown;
  take_down: unknown;
  effect_stickers: unknown;
  private_item: unknown;
  duet_enabled: boolean;
  stitch_enabled: boolean;
  stickers_on_item: unknown;
  share_enabled: unknown;
  comments: unknown;
  duet_display: unknown;
  stitch_display: unknown;
  index_enabled: boolean;
  diversification_labels: unknown;
  diversification_id: unknown;
  channel_tags: unknown;
  keyword_tags: unknown;
  is_ai_gc: unknown;
  aigc_label_type: unknown;
  ai_gc_description: unknown;
  diggcount: number | null;
  sharecount: number | null;
  commentcount: number | null;
  playcount: number | null;
  collectcount: number | null;
  repostcount: number | null;
}

export interface FileMetadata {
  id: number | null;
  filepath: string | null;
  duration: unknown;
  height: unknown;
  width: unknown;
  ratio: string | number | null;
  volume_loudness: unknown;
  volume_peak: unknown;
  has_original_audio: unknown;
  enable_audio_caption: unknown;
  no_caption_reason: unknown;
  is_slide?: boolean;
}

export interface MusicMetadata {
  id: number | null;
  title: string | null;
  author_name: string | null;
  original: unknown;
  schedule_search_time: unknown;
  collected: unknown;
  precise_duration: unknown;
}

export interface AuthorMetadata {
  id: number | null;
  username: string | null;
  name: string | null;
  signature: string | null;
  create_time: unknown;
  verified: unknown;
  ftc: unknown;
  relation: unknown;
  open_favorite: unknown;
  comment_setting: unknown;
  duet_setting: unknown;
  stitch_setting: unknown;
  private_account: unknown;
  secret: unknown;
  is_ad_virtual: unknown;
  download_setting: unknown;
  recommend_reason: unknown;
  suggest_account_bind: unknown;
}

export interface HashtagMetadata {
  name: string | undefined;
  id: number | null;
  type: unknown;
  sub_type: unknown;
  is_commerce: unknown;
  description: string | null;
}

export interface FilteredTiktokData {
  video_metadata: VideoMetadata;
  file_metadata: FileMetadata;
  music_metadata: MusicMetadata;
  author_metadata: AuthorMetadata;
  hashtags_metadata: HashtagMetadata[];
}

export interface LinkToBinaries {
  mp4: string | null;
  mp3: string | null;
  jpegs: Array<{ imageURL?: { urlList?: string[] } }> | null;
}

export interface ScrapedBinaries {
  mp3: Buffer | null;
  mp4: Buffer | null;
  jpegs: Buffer[];
}

export interface ScraperOptions {
  waitTime?: number;
  outputDir?: string;
  progressDbPath?: string;
  clearConsole?: boolean;
}
