import type {
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  PostV2,
  CommentV2,
} from '@devvit/web/shared';
import { reddit, redis, settings } from '@devvit/web/server';
import {
  T1 as asT1ID,
  T3 as asT3ID,
  isT1 as isT1ID,
  isT3 as isT3ID,
  type T1,
  type T3,
} from '@devvit/shared-types/tid.js';

export const COPYRIGHT_FILTER_REASON =
  'Possible copyrighted media: review required';

export const COPYRIGHT_SCAN_API_KEY_SETTING = 'openaiApiKey';
export const COPYRIGHT_SCAN_MODEL_SETTING = 'copyrightScanModel';
export const COPYRIGHT_FILTER_ENABLED_SETTING =
  'copyrightMaterialFilterEnabled';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEDUPE_TTL_DAYS = 30;
const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_COPYRIGHT_SCAN_MODEL = 'gpt-4.1-mini';

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/giu;

const MUSIC_AND_VIDEO_HOSTS = [
  'audiomack.com',
  'bandcamp.com',
  'deezer.com',
  'dailymotion.com',
  'facebook.com',
  'instagram.com',
  'music.apple.com',
  'music.youtube.com',
  'soundcloud.com',
  'spotify.com',
  'tidal.com',
  'tiktok.com',
  'twitch.tv',
  'vimeo.com',
  'youtu.be',
  'youtube.com',
];

const IMAGE_HOSTS = [
  '500px.com',
  'deviantart.com',
  'flickr.com',
  'giphy.com',
  'gfycat.com',
  'imgur.com',
  'pin.it',
  'pinterest.com',
  'redd.it',
  'redgifs.com',
];

const MEDIA_FILE_EXTENSIONS = [
  '.aac',
  '.avi',
  '.flac',
  '.gif',
  '.jpeg',
  '.jpg',
  '.m4a',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.ogg',
  '.png',
  '.wav',
  '.webm',
  '.webp',
];

const COPYRIGHT_SIGNAL_PATTERNS = [
  /\bcopyright(?:ed)?\b/iu,
  /\bdmca\b/iu,
  /\bcontent id\b/iu,
  /\blicen[cs](?:e|ed|ing)\b/iu,
  /\brightsholder\b/iu,
  /\ball rights reserved\b/iu,
  /\bunauthori[sz]ed\b/iu,
  /\breupload(?:ed)?\b/iu,
  /\bbootleg\b/iu,
  /\bleak(?:ed)?\b/iu,
  /\bpirated?\b/iu,
  /\btorrent\b/iu,
  /\bfull (?:album|movie|episode|film|concert|soundtrack)\b/iu,
  /\b(?:movie|film|episode|anime|manga|comic|tv show) (?:download|stream)\b/iu,
  /\b(?:mp3|flac|soundtrack|album|single|song|official audio|music video)\b/iu,
  /\b(?:poster|scan|artwork|photo|photograph|illustration|cover art)\b/iu,
];

type MediaCandidateReview = {
  shouldScan: boolean;
  reason: string;
};

type CopyrightScanResult = {
  shouldFilter: boolean;
  confidence: number;
  reason: string;
};

type FilterResult = {
  status: 'filtered' | 'skipped' | 'error';
  reason: string;
  thingId?: T1 | T3;
};

type MediaReviewInput = {
  textParts: string[];
  urls: string[];
  hasNativeMedia: boolean;
};

const normalizeHost = (host: string) =>
  host.toLowerCase().replace(/^www\./u, '');

const getUrlHost = (rawUrl: string) => {
  try {
    const url = rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;

    return normalizeHost(new URL(url).hostname);
  } catch {
    return undefined;
  }
};

const getUrlPath = (rawUrl: string) => {
  try {
    const url = rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;

    return new URL(url).pathname.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
};

const hostMatches = (host: string, knownHost: string) =>
  host === knownHost || host.endsWith(`.${knownHost}`);

const isKnownHost = (rawUrl: string, hosts: string[]) => {
  const host = getUrlHost(rawUrl);

  if (!host) {
    return false;
  }

  return hosts.some((knownHost) => hostMatches(host, knownHost));
};

const isMediaFileUrl = (rawUrl: string) => {
  const path = getUrlPath(rawUrl);

  return MEDIA_FILE_EXTENSIONS.some((extension) => path.endsWith(extension));
};

const isMediaUrl = (rawUrl: string) =>
  isMediaFileUrl(rawUrl) ||
  isKnownHost(rawUrl, MUSIC_AND_VIDEO_HOSTS) ||
  isKnownHost(rawUrl, IMAGE_HOSTS);

const getUrlsFromText = (text: string) =>
  Array.from(text.matchAll(URL_PATTERN)).map((match) => match[0]);

const getCopyrightSignal = (text: string) =>
  COPYRIGHT_SIGNAL_PATTERNS.find((pattern) => pattern.test(text));

export const reviewCopyrightMaterial = ({
  textParts,
  urls,
  hasNativeMedia,
}: MediaReviewInput): MediaCandidateReview => {
  const combinedText = textParts.filter(Boolean).join('\n');
  const linkedUrls = [...urls, ...getUrlsFromText(combinedText)];
  const hasMediaUrl = linkedUrls.some(isMediaUrl);
  const hasMedia = hasNativeMedia || hasMediaUrl;

  if (!hasMedia) {
    return {
      shouldScan: false,
      reason: 'content does not contain media',
    };
  }

  const signal = getCopyrightSignal(combinedText);

  if (signal) {
    return {
      shouldScan: true,
      reason: `matched copyright signal ${signal.source}`,
    };
  }

  const hasMusicOrVideoLink = linkedUrls.some((url) =>
    isKnownHost(url, MUSIC_AND_VIDEO_HOSTS)
  );

  if (hasMusicOrVideoLink) {
    return {
      shouldScan: true,
      reason: 'contains a known music or video media URL',
    };
  }

  return {
    shouldScan: true,
    reason: 'contains media that requires external copyright classification',
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getStringProperty = (
  record: Record<string, unknown>,
  propertyName: string
) => {
  const value = record[propertyName];

  return typeof value === 'string' ? value : undefined;
};

const getNumberProperty = (
  record: Record<string, unknown>,
  propertyName: string
) => {
  const value = record[propertyName];

  return typeof value === 'number' ? value : undefined;
};

const getBooleanProperty = (
  record: Record<string, unknown>,
  propertyName: string
) => {
  const value = record[propertyName];

  return typeof value === 'boolean' ? value : undefined;
};

const getSettingString = async (settingName: string, fallback = '') => {
  const value = await settings.get(settingName);

  return typeof value === 'string' ? value.trim() : fallback;
};

const isCopyrightFilterEnabled = async () => {
  const value = await settings.get(COPYRIGHT_FILTER_ENABLED_SETTING);

  return typeof value === 'boolean' ? value : true;
};

const extractOpenAIOutputText = (data: unknown) => {
  if (!isRecord(data)) {
    return undefined;
  }

  const outputText = getStringProperty(data, 'output_text');

  if (outputText) {
    return outputText;
  }

  const output = data.output;

  if (!Array.isArray(output)) {
    return undefined;
  }

  for (const outputItem of output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (!isRecord(contentItem)) {
        continue;
      }

      const text = getStringProperty(contentItem, 'text');

      if (text) {
        return text;
      }
    }
  }

  return undefined;
};

const parseCopyrightScanResult = (
  outputText: string
): CopyrightScanResult | undefined => {
  try {
    const parsed: unknown = JSON.parse(outputText);

    if (!isRecord(parsed)) {
      return undefined;
    }

    const shouldFilter = getBooleanProperty(parsed, 'shouldFilter');
    const confidence = getNumberProperty(parsed, 'confidence');
    const reason = getStringProperty(parsed, 'reason');

    if (
      typeof shouldFilter !== 'boolean' ||
      typeof confidence !== 'number' ||
      typeof reason !== 'string'
    ) {
      return undefined;
    }

    return {
      shouldFilter,
      confidence,
      reason,
    };
  } catch {
    return undefined;
  }
};

const getOpenAIRequestBody = (input: MediaReviewInput, candidateReason: string) => ({
  model: DEFAULT_COPYRIGHT_SCAN_MODEL,
  store: false,
  instructions:
    'You are a copyright moderation classifier for Reddit moderators. ' +
    'Decide whether the submitted post or reply likely contains copyrighted image, video, or song material that should be sent to a moderator queue for human review. ' +
    'Use only the provided title, text, metadata, provider names, and URLs. Do not claim legal certainty. ' +
    'Return shouldFilter true only when there is a concrete copyright review signal, such as an uploaded or linked song/music video, official media repost, full movie/episode/album, scan, cover art, or explicit copyright/DMCA wording.',
  input: JSON.stringify({
    candidateReason,
    textParts: input.textParts,
    urls: input.urls,
    hasNativeMedia: input.hasNativeMedia,
  }),
  text: {
    format: {
      type: 'json_schema',
      name: 'copyright_scan_result',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shouldFilter: {
            type: 'boolean',
            description:
              'Whether moderators should review this content for likely copyrighted media.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence in the classification.',
          },
          reason: {
            type: 'string',
            description: 'Short moderation-facing reason.',
          },
        },
        required: ['shouldFilter', 'confidence', 'reason'],
      },
    },
  },
});

const scanWithOpenAI = async (
  input: MediaReviewInput,
  candidateReason: string
): Promise<CopyrightScanResult> => {
  const [apiKey, configuredModel] = await Promise.all([
    getSettingString(COPYRIGHT_SCAN_API_KEY_SETTING),
    getSettingString(COPYRIGHT_SCAN_MODEL_SETTING, DEFAULT_COPYRIGHT_SCAN_MODEL),
  ]);

  if (!apiKey) {
    return {
      shouldFilter: false,
      confidence: 0,
      reason: `OpenAI API key is not configured in ${COPYRIGHT_SCAN_API_KEY_SETTING}`,
    };
  }

  const requestBody = {
    ...getOpenAIRequestBody(input, candidateReason),
    model: configuredModel || DEFAULT_COPYRIGHT_SCAN_MODEL,
  };

  const response = await fetch(OPENAI_RESPONSES_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    return {
      shouldFilter: false,
      confidence: 0,
      reason: `OpenAI copyright scan failed with HTTP ${response.status}`,
    };
  }

  const data: unknown = await response.json();
  const outputText = extractOpenAIOutputText(data);

  if (!outputText) {
    return {
      shouldFilter: false,
      confidence: 0,
      reason: 'OpenAI copyright scan returned no text output',
    };
  }

  const result = parseCopyrightScanResult(outputText);

  if (!result) {
    return {
      shouldFilter: false,
      confidence: 0,
      reason: 'OpenAI copyright scan returned invalid structured output',
    };
  }

  return result;
};

const getPostId = (post: PostV2 | undefined) => {
  const rawPostId = post?.id;

  if (!rawPostId) {
    return undefined;
  }

  if (isT3ID(rawPostId)) {
    return rawPostId;
  }

  return asT3ID(rawPostId);
};

const getCommentId = (comment: CommentV2 | undefined) => {
  const rawCommentId = comment?.id;

  if (!rawCommentId) {
    return undefined;
  }

  if (isT1ID(rawCommentId)) {
    return rawCommentId;
  }

  return asT1ID(rawCommentId);
};

const getPostReviewInput = (post: PostV2): MediaReviewInput => ({
  textParts: [
    post.title,
    post.selftext,
    post.url,
    post.media?.type ?? '',
    post.media?.oembed?.title ?? '',
    post.media?.oembed?.description ?? '',
    post.media?.oembed?.providerName ?? '',
    post.media?.oembed?.providerUrl ?? '',
    post.media?.oembed?.thumbnailUrl ?? '',
  ],
  urls: [
    post.url,
    post.thumbnail,
    ...post.mediaUrls,
    ...post.galleryImages,
    post.media?.redditVideo?.fallbackUrl ?? '',
    post.media?.redditVideo?.dashUrl ?? '',
    post.media?.redditVideo?.hlsUrl ?? '',
    post.media?.redditVideo?.scrubberMediaUrl ?? '',
    post.media?.oembed?.thumbnailUrl ?? '',
    post.media?.oembed?.providerUrl ?? '',
  ].filter(Boolean),
  hasNativeMedia:
    post.isVideo ||
    post.isImage ||
    post.isGallery ||
    post.isMultiMedia ||
    post.mediaUrls.length > 0 ||
    post.galleryImages.length > 0 ||
    Boolean(post.media),
});

const getCommentReviewInput = (comment: CommentV2): MediaReviewInput => ({
  textParts: [comment.body, ...comment.mediaUrls, ...comment.elementTypes],
  urls: comment.mediaUrls,
  hasNativeMedia: comment.hasMedia || comment.mediaUrls.length > 0,
});

const filterForCopyrightReview = async (
  thingId: T1 | T3,
  reviewReason: string
) => {
  const dedupeKey = `copyright-material-filter:filtered:${thingId}`;
  const alreadyFiltered = await redis.get(dedupeKey);

  if (alreadyFiltered) {
    return {
      status: 'skipped',
      reason: 'content was already filtered by copyright material filter',
      thingId,
    } satisfies FilterResult;
  }

  await reddit.filter(thingId, COPYRIGHT_FILTER_REASON, false);

  const expiration = new Date(Date.now() + DEDUPE_TTL_DAYS * DAY_IN_MS);

  await redis.set(dedupeKey, reviewReason, { expiration });

  return {
    status: 'filtered',
    reason: reviewReason,
    thingId,
  } satisfies FilterResult;
};

export const handleCopyrightPostSubmit = async (
  input: OnPostSubmitRequest
): Promise<FilterResult> => {
  if (!(await isCopyrightFilterEnabled())) {
    return {
      status: 'skipped',
      reason: 'copyright material filter is disabled for this subreddit',
    };
  }

  const post = input.post;
  const postId = getPostId(post);

  if (!post || !postId) {
    return {
      status: 'skipped',
      reason: 'post submit event did not include a post id',
    };
  }

  const reviewInput = getPostReviewInput(post);
  const review = reviewCopyrightMaterial(reviewInput);

  if (!review.shouldScan) {
    return {
      status: 'skipped',
      reason: review.reason,
      thingId: postId,
    };
  }

  const scan = await scanWithOpenAI(reviewInput, review.reason);

  if (!scan.shouldFilter) {
    return {
      status: 'skipped',
      reason: scan.reason,
      thingId: postId,
    };
  }

  return filterForCopyrightReview(
    postId,
    `OpenAI copyright scan (${scan.confidence}): ${scan.reason}`
  );
};

export const handleCopyrightCommentSubmit = async (
  input: OnCommentSubmitRequest
): Promise<FilterResult> => {
  if (!(await isCopyrightFilterEnabled())) {
    return {
      status: 'skipped',
      reason: 'copyright material filter is disabled for this subreddit',
    };
  }

  const comment = input.comment;
  const commentId = getCommentId(comment);

  if (!comment || !commentId) {
    return {
      status: 'skipped',
      reason: 'comment submit event did not include a comment id',
    };
  }

  const reviewInput = getCommentReviewInput(comment);
  const review = reviewCopyrightMaterial(reviewInput);

  if (!review.shouldScan) {
    return {
      status: 'skipped',
      reason: review.reason,
      thingId: commentId,
    };
  }

  const scan = await scanWithOpenAI(reviewInput, review.reason);

  if (!scan.shouldFilter) {
    return {
      status: 'skipped',
      reason: scan.reason,
      thingId: commentId,
    };
  }

  return filterForCopyrightReview(
    commentId,
    `OpenAI copyright scan (${scan.confidence}): ${scan.reason}`
  );
};
