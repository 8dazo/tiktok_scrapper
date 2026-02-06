import type { RawTiktokDataSlot, FilteredTiktokData, HashtagMetadata } from "./types.js";

function forceToInt(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.floor(n) === n ? n : null;
}

function prepHashtagsAndMentions(dataSlot: RawTiktokDataSlot): [HashtagMetadata[], string[]] {
  const textElements = dataSlot.textExtra ?? null;
  const challenges = dataSlot.challenges ?? [];
  const hashtagsMetadata: HashtagMetadata[] = [];
  const mentionsList: string[] = [];

  if (textElements) {
    for (const element of textElements) {
      const mention = element.userId;
      if (mention == null) {
        const hashtagData: HashtagMetadata = {
          name: element.hashtagName,
          id: forceToInt(element.hashtagId),
          type: element.type,
          sub_type: (element as { subType?: unknown }).subType,
          is_commerce: element.isCommerce,
          description: null,
        };
        const matching = challenges.filter(
          (c) => forceToInt((c as { id?: string | number }).id) === hashtagData.id
        );
        hashtagData.description = matching[0]
          ? (matching[0] as { desc?: string }).desc ?? null
          : null;
        hashtagsMetadata.push(hashtagData);
      } else {
        mentionsList.push(mention);
      }
    }
  }
  return [hashtagsMetadata, mentionsList];
}

/**
 * Transform raw TikTok itemStruct into structured video/file/music/author metadata.
 */
export function filterTiktokData(dataSlot: RawTiktokDataSlot): FilteredTiktokData {
  const [hashtagsMetadata, mentionsList] = prepHashtagsAndMentions(dataSlot);
  const createTime = dataSlot.createTime;
  const author = (dataSlot.author ?? {}) as Record<string, unknown>;
  const music = (dataSlot.music ?? {}) as Record<string, unknown>;
  const video = (dataSlot.video ?? {}) as Record<string, unknown>;
  const statsData = (dataSlot.statsV2 ?? dataSlot.stats ?? {}) as Record<string, unknown>;
  const volumeInfo = (video.volumeInfo ?? {}) as Record<string, unknown>;
  const claInfo = (video.claInfo ?? {}) as Record<string, unknown>;

  let timeCreated: string | null = null;
  if (createTime != null) {
    const ts = typeof createTime === "number" ? createTime : parseInt(String(createTime), 10);
    if (Number.isFinite(ts)) {
      timeCreated = new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "");
    }
  }

  let locationCreated: string | null = (dataSlot.locationCreated as string) ?? null;
  if (locationCreated && locationCreated.length > 2) {
    locationCreated = locationCreated === "FAKE-AD" ? "XX" : null;
  }

  let suggestedWords = dataSlot.suggestedWords;
  if (Array.isArray(suggestedWords) && suggestedWords.length === 0) {
    suggestedWords = undefined;
  }

  const videoMetadata = {
    id: forceToInt(dataSlot.id),
    time_created: timeCreated,
    author_id: forceToInt((author.id as string | number) ?? null),
    description: (dataSlot.desc as string) ?? null,
    hashtags: hashtagsMetadata.map((h) => h.name ?? "").filter(Boolean),
    mentions: mentionsList.length > 0 ? mentionsList : null,
    music_id: forceToInt((music.id as string | number) ?? null),
    schedule_time: dataSlot.scheduleTime,
    location_created: locationCreated,
    is_ad: (dataSlot.isAd as boolean) ?? false,
    suggested_words: suggestedWords,
    warn_info: dataSlot.warnInfo,
    original_item: dataSlot.originalItem,
    offical_item: dataSlot.officalItem,
    secret: dataSlot.secret,
    for_friend: dataSlot.forFriend,
    digged: dataSlot.digged,
    item_comment_status: dataSlot.itemCommentStatus,
    take_down: dataSlot.takeDown,
    effect_stickers: dataSlot.effectStickers,
    private_item: dataSlot.privateItem,
    duet_enabled: (dataSlot.duetEnabled as boolean) ?? false,
    stitch_enabled: (dataSlot.stitchEnabled as boolean) ?? false,
    stickers_on_item: dataSlot.stickersOnItem,
    share_enabled: dataSlot.shareEnabled,
    comments: dataSlot.comments,
    duet_display: dataSlot.duetDisplay,
    stitch_display: dataSlot.stitchDisplay,
    index_enabled: (dataSlot.indexEnabled as boolean) ?? false,
    diversification_labels: dataSlot.diversificationLabels,
    diversification_id: dataSlot.diversificationId,
    channel_tags: dataSlot.channelTags,
    keyword_tags: dataSlot.keywordTags,
    is_ai_gc: dataSlot.IsAigc,
    aigc_label_type: dataSlot.aigcLabelType,
    ai_gc_description: dataSlot.AIGCDescription,
    diggcount: forceToInt(statsData.diggCount),
    sharecount: forceToInt(statsData.shareCount),
    commentcount: forceToInt(statsData.commentCount),
    playcount: forceToInt(statsData.playCount),
    collectcount: forceToInt(statsData.collectCount),
    repostcount: forceToInt(statsData.repostCount),
  };

  for (const k of [
    "warn_info",
    "effect_stickers",
    "stickers_on_item",
    "comments",
    "channel_tags",
    "diversification_labels",
  ] as const) {
    const v = videoMetadata[k];
    const isEmpty =
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
    if (isEmpty) {
      (videoMetadata as Record<string, unknown>)[k] = null;
    }
  }
  if (videoMetadata.ai_gc_description === "") {
    (videoMetadata as Record<string, unknown>).ai_gc_description = null;
  }

  let ratio: string | number | null = (video.ratio as string | number) ?? null;
  if (ratio != null) {
    const s = String(ratio).replace(/p$/i, "");
    const n = parseInt(s, 10);
    ratio = Number.isFinite(n) ? n : null;
  }

  const fileMetadata = {
    id: videoMetadata.id,
    filepath: null as string | null,
    duration: video.duration,
    height: video.height,
    width: video.width,
    ratio,
    volume_loudness: volumeInfo.Loudness,
    volume_peak: volumeInfo.Peak,
    has_original_audio: claInfo.hasOriginalAudio,
    enable_audio_caption: claInfo.enableAutoCaption,
    no_caption_reason: claInfo.noCaptionReason,
  };

  const musicMetadata = {
    id: videoMetadata.music_id,
    title: (music.title as string) ?? null,
    author_name: (music.authorName as string) ?? null,
    original: music.original,
    schedule_search_time: music.scheduleSearchTime,
    collected: music.collected,
    precise_duration: music.preciseDuration,
  };

  const authorMetadata = {
    id: forceToInt(author.id),
    username: (author.uniqueId as string) ?? null,
    name: (author.nickname as string) ?? null,
    signature: (author.signature as string) ?? null,
    create_time: author.createTime,
    verified: author.verified,
    ftc: author.ftc,
    relation: author.relation,
    open_favorite: author.openFavorite,
    comment_setting: author.commentSetting,
    duet_setting: author.duetSetting,
    stitch_setting: author.stitchSetting,
    private_account: author.privateAccount,
    secret: author.secret,
    is_ad_virtual: author.isADVirtual,
    download_setting: author.downloadSetting,
    recommend_reason: author.recommendReason,
    suggest_account_bind: author.suggestAccountBind,
  };

  return {
    video_metadata: videoMetadata,
    file_metadata: fileMetadata,
    music_metadata: musicMetadata,
    author_metadata: authorMetadata,
    hashtags_metadata: hashtagsMetadata,
  };
}
