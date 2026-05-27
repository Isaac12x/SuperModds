import type {
  CommentV2,
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  PostV2,
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
import { COPYRIGHT_SCAN_API_KEY_SETTING } from './copyrightMaterialFilter';

export const ADULT_IMAGE_FILTER_REASON =
  'Potential +18 image content: review required';

export const ADULT_IMAGE_SCAN_MODEL_SETTING = 'adultImageScanModel';
export const ADULT_IMAGE_FILTER_ENABLED_SETTING =
  'adultImageReviewFilterEnabled';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEDUPE_TTL_DAYS = 30;
const MAX_IMAGES_PER_SCAN = 4;
const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_ADULT_IMAGE_SCAN_MODEL = 'gpt-4.1-mini';

const IMAGE_FILE_EXTENSIONS = [
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
];

const IMAGE_HOSTS = [
  '500px.com',
  'deviantart.com',
  'flickr.com',
  'giphy.com',
  'gfycat.com',
  'i.redd.it',
  'imgur.com',
  'pin.it',
  'pinterest.com',
  'preview.redd.it',
  'redd.it',
];

type ImageReviewInput = {
  title: string;
  body: string;
  imageUrls: string[];
};

type AdultImageScanResult = {
  shouldFilter: boolean;
  confidence: number;
  reason: string;
};

type FilterResult = {
  status: 'filtered' | 'skipped' | 'error';
  reason: string;
  thingId?: T1 | T3;
};

const normalizeHost = (host: string) =>
  host.toLowerCase().replace(/^www\./u, '');

const normalizeUrl = (rawUrl: string) =>
  rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;

const getUrl = (rawUrl: string) => {
  try {
    return new URL(normalizeUrl(rawUrl));
  } catch {
    return undefined;
  }
};

const hostMatches = (host: string, knownHost: string) =>
  host === knownHost || host.endsWith(`.${knownHost}`);

const isKnownImageHost = (rawUrl: string) => {
  const url = getUrl(rawUrl);

  if (!url) {
    return false;
  }

  const host = normalizeHost(url.hostname);

  return IMAGE_HOSTS.some((knownHost) => hostMatches(host, knownHost));
};

const isImageFileUrl = (rawUrl: string) => {
  const url = getUrl(rawUrl);
  const path = url ? url.pathname.toLowerCase() : rawUrl.toLowerCase();

  return IMAGE_FILE_EXTENSIONS.some((extension) => path.endsWith(extension));
};

const isSupportedImageUrl = (rawUrl: string) =>
  rawUrl.trim().length > 0 && (isImageFileUrl(rawUrl) || isKnownImageHost(rawUrl));

const uniqueStrings = (values: string[]) => {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    const normalizedValue = value.trim();

    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    uniqueValues.push(normalizedValue);
  }

  return uniqueValues;
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

const isAdultImageFilterEnabled = async () => {
  const value = await settings.get(ADULT_IMAGE_FILTER_ENABLED_SETTING);

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

const parseAdultImageScanResult = (
  outputText: string
): AdultImageScanResult | undefined => {
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

const getOpenAIRequestBody = (input: ImageReviewInput) => ({
  model: DEFAULT_ADULT_IMAGE_SCAN_MODEL,
  instructions:
    'You are an image moderation classifier for Reddit moderators. ' +
    'Review the provided images and decide whether the submission should go to the needs review queue for potential +18 content. ' +
    'Return shouldFilter true for explicit nudity, exposed genitals, exposed female nipples, sexual activity, fetish content, pornography, or clearly sexualized adult imagery. ' +
    'Return false for ordinary swimwear, non-sexual bare skin, medical context, fitness imagery, or images where no +18 content is visible. ' +
    'Do not describe explicit details beyond a short moderation-facing reason.',
  input: [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: JSON.stringify({
            title: input.title,
            body: input.body,
            imageCount: input.imageUrls.length,
          }),
        },
        ...input.imageUrls.map((imageUrl) => ({
          type: 'input_image',
          image_url: imageUrl,
          detail: 'low',
        })),
      ],
    },
  ],
  text: {
    format: {
      type: 'json_schema',
      name: 'adult_image_scan_result',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shouldFilter: {
            type: 'boolean',
            description:
              'Whether moderators should review this content for potential +18 image content.',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
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
  input: ImageReviewInput
): Promise<AdultImageScanResult> => {
  const [apiKey, configuredModel] = await Promise.all([
    getSettingString(COPYRIGHT_SCAN_API_KEY_SETTING),
    getSettingString(
      ADULT_IMAGE_SCAN_MODEL_SETTING,
      DEFAULT_ADULT_IMAGE_SCAN_MODEL
    ),
  ]);

  if (!apiKey) {
    return {
      shouldFilter: false,
      confidence: 0,
      reason: `OpenAI API key is not configured in ${COPYRIGHT_SCAN_API_KEY_SETTING}`,
    };
  }

  const requestBody = {
    ...getOpenAIRequestBody(input),
    model: configuredModel || DEFAULT_ADULT_IMAGE_SCAN_MODEL,
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
      reason: `OpenAI +18 image scan failed with HTTP ${response.status}`,
    };
  }

  const data: unknown = await response.json();
  const outputText = extractOpenAIOutputText(data);

  if (!outputText) {
    return {
      shouldFilter: false,
      confidence: 0,
      reason: 'OpenAI +18 image scan returned no text output',
    };
  }

  const result = parseAdultImageScanResult(outputText);

  if (!result) {
    return {
      shouldFilter: false,
      confidence: 0,
      reason: 'OpenAI +18 image scan returned invalid structured output',
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

const getPostImageReviewInput = (post: PostV2): ImageReviewInput => {
  const imageUrls = uniqueStrings([
    post.isImage ? post.url : '',
    post.thumbnail,
    ...post.mediaUrls,
    ...post.galleryImages,
    post.media?.oembed?.thumbnailUrl ?? '',
  ])
    .filter(isSupportedImageUrl)
    .slice(0, MAX_IMAGES_PER_SCAN);

  return {
    title: post.title,
    body: post.selftext,
    imageUrls,
  };
};

const getCommentImageReviewInput = (comment: CommentV2): ImageReviewInput => ({
  title: '',
  body: comment.body,
  imageUrls: uniqueStrings(comment.mediaUrls)
    .filter(isSupportedImageUrl)
    .slice(0, MAX_IMAGES_PER_SCAN),
});

const filterForAdultImageReview = async (
  thingId: T1 | T3,
  reviewReason: string
) => {
  const dedupeKey = `adult-image-review-filter:filtered:${thingId}`;
  const alreadyFiltered = await redis.get(dedupeKey);

  if (alreadyFiltered) {
    return {
      status: 'skipped',
      reason: 'content was already filtered by +18 image review filter',
      thingId,
    } satisfies FilterResult;
  }

  await reddit.filter(thingId, ADULT_IMAGE_FILTER_REASON, false);

  const expiration = new Date(Date.now() + DEDUPE_TTL_DAYS * DAY_IN_MS);

  await redis.set(dedupeKey, reviewReason, { expiration });

  return {
    status: 'filtered',
    reason: reviewReason,
    thingId,
  } satisfies FilterResult;
};

export const handleAdultImagePostSubmit = async (
  input: OnPostSubmitRequest
): Promise<FilterResult> => {
  if (!(await isAdultImageFilterEnabled())) {
    return {
      status: 'skipped',
      reason: '+18 image review filter is disabled for this subreddit',
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

  const reviewInput = getPostImageReviewInput(post);

  if (reviewInput.imageUrls.length === 0) {
    return {
      status: 'skipped',
      reason: 'post does not contain supported image URLs',
      thingId: postId,
    };
  }

  const scan = await scanWithOpenAI(reviewInput);

  if (!scan.shouldFilter) {
    return {
      status: 'skipped',
      reason: scan.reason,
      thingId: postId,
    };
  }

  return filterForAdultImageReview(
    postId,
    `OpenAI +18 image scan (${scan.confidence}): ${scan.reason}`
  );
};

export const handleAdultImageCommentSubmit = async (
  input: OnCommentSubmitRequest
): Promise<FilterResult> => {
  if (!(await isAdultImageFilterEnabled())) {
    return {
      status: 'skipped',
      reason: '+18 image review filter is disabled for this subreddit',
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

  const reviewInput = getCommentImageReviewInput(comment);

  if (reviewInput.imageUrls.length === 0) {
    return {
      status: 'skipped',
      reason: 'comment does not contain supported image URLs',
      thingId: commentId,
    };
  }

  const scan = await scanWithOpenAI(reviewInput);

  if (!scan.shouldFilter) {
    return {
      status: 'skipped',
      reason: scan.reason,
      thingId: commentId,
    };
  }

  return filterForAdultImageReview(
    commentId,
    `OpenAI +18 image scan (${scan.confidence}): ${scan.reason}`
  );
};
