import type {
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  PostV2,
  CommentV2,
} from '@devvit/web/shared';
import { reddit, redis } from '@devvit/web/server';
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

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEDUPE_TTL_DAYS = 30;

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

type CopyrightReview = {
  shouldFilter: boolean;
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
}: MediaReviewInput): CopyrightReview => {
  const combinedText = textParts.filter(Boolean).join('\n');
  const linkedUrls = [...urls, ...getUrlsFromText(combinedText)];
  const hasMediaUrl = linkedUrls.some(isMediaUrl);
  const hasMedia = hasNativeMedia || hasMediaUrl;

  if (!hasMedia) {
    return {
      shouldFilter: false,
      reason: 'content does not contain media',
    };
  }

  const signal = getCopyrightSignal(combinedText);

  if (signal) {
    return {
      shouldFilter: true,
      reason: `matched copyright signal ${signal.source}`,
    };
  }

  const hasMusicOrVideoLink = linkedUrls.some((url) =>
    isKnownHost(url, MUSIC_AND_VIDEO_HOSTS)
  );

  if (hasMusicOrVideoLink) {
    return {
      shouldFilter: true,
      reason: 'contains a known music or video media URL',
    };
  }

  return {
    shouldFilter: false,
    reason: 'media did not match copyright review signals',
  };
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
  const post = input.post;
  const postId = getPostId(post);

  if (!post || !postId) {
    return {
      status: 'skipped',
      reason: 'post submit event did not include a post id',
    };
  }

  const review = reviewCopyrightMaterial(getPostReviewInput(post));

  if (!review.shouldFilter) {
    return {
      status: 'skipped',
      reason: review.reason,
      thingId: postId,
    };
  }

  return filterForCopyrightReview(postId, review.reason);
};

export const handleCopyrightCommentSubmit = async (
  input: OnCommentSubmitRequest
): Promise<FilterResult> => {
  const comment = input.comment;
  const commentId = getCommentId(comment);

  if (!comment || !commentId) {
    return {
      status: 'skipped',
      reason: 'comment submit event did not include a comment id',
    };
  }

  const review = reviewCopyrightMaterial(getCommentReviewInput(comment));

  if (!review.shouldFilter) {
    return {
      status: 'skipped',
      reason: review.reason,
      thingId: commentId,
    };
  }

  return filterForCopyrightReview(commentId, review.reason);
};
