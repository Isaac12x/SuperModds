import type { OnPostUpdateRequest } from '@devvit/web/shared';
import { reddit, redis } from '@devvit/web/server';
import { T3 as asT3ID, isT3 as isT3ID } from '@devvit/shared-types/tid.js';

export const REDACTED_EDIT_REPORT_REASON =
  'Not allowed changes: moderator rejected';

export const REDACTED_EDIT_MIN_POST_AGE_DAYS = 7;

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEDUPE_TTL_DAYS = 30;
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
const LETTER_PATTERN = /\p{L}/u;
const MEANINGFUL_WORD_MIN_LENGTH = 2;
const MIN_MEANINGFUL_WORDS = 3;
const MAX_MEANINGFUL_WORD_RATIO = 0.2;
const MIN_NON_WORD_RATIO = 0.5;

type RedactedEditReview = {
  shouldReport: boolean;
  reason: string;
};

type RedactedEditReportResult = {
  status: 'reported' | 'skipped' | 'error';
  reason: string;
  postId?: string;
};

export const isOlderPost = (createdAtSeconds: number, nowMs = Date.now()) => {
  if (!Number.isFinite(createdAtSeconds) || createdAtSeconds <= 0) {
    return false;
  }

  const ageMs = nowMs - createdAtSeconds * 1000;

  return ageMs >= REDACTED_EDIT_MIN_POST_AGE_DAYS * DAY_IN_MS;
};

const getMeaningfulWords = (body: string) =>
  Array.from(body.matchAll(WORD_PATTERN))
    .map((match) => match[0])
    .filter(
      (word) =>
        word.length >= MEANINGFUL_WORD_MIN_LENGTH && LETTER_PATTERN.test(word)
    );

const getNonWordRatio = (body: string) => {
  const compactBody = body.replace(/\s+/g, '');

  if (compactBody.length === 0) {
    return 1;
  }

  const nonWordCharacters = compactBody.replace(/[\p{L}\p{N}_]/gu, '');

  return nonWordCharacters.length / compactBody.length;
};

export const reviewRedactedEditBody = (body: string): RedactedEditReview => {
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    return {
      shouldReport: true,
      reason: 'edited body is empty',
    };
  }

  const meaningfulWords = getMeaningfulWords(trimmedBody);
  const wordRatio = meaningfulWords.join('').length / trimmedBody.length;
  const nonWordRatio = getNonWordRatio(trimmedBody);

  if (
    meaningfulWords.length < MIN_MEANINGFUL_WORDS &&
    (wordRatio <= MAX_MEANINGFUL_WORD_RATIO ||
      nonWordRatio >= MIN_NON_WORD_RATIO)
  ) {
    return {
      shouldReport: true,
      reason: 'edited body does not contain enough words',
    };
  }

  return {
    shouldReport: false,
    reason: 'edited body contains word content',
  };
};

const getPostId = (input: OnPostUpdateRequest) => {
  const rawPostId = input.post?.id;

  if (!rawPostId) {
    return undefined;
  }

  if (isT3ID(rawPostId)) {
    return rawPostId;
  }

  return asT3ID(rawPostId);
};

const getUpdatedBody = (input: OnPostUpdateRequest) => input.post?.selftext ?? '';

const getCreatedAt = (input: OnPostUpdateRequest) => input.post?.createdAt ?? 0;

export const handleRedactedPostUpdate = async (
  input: OnPostUpdateRequest
): Promise<RedactedEditReportResult> => {
  const postId = getPostId(input);

  if (!postId) {
    return {
      status: 'skipped',
      reason: 'post update event did not include a post id',
    };
  }

  if (!isOlderPost(getCreatedAt(input))) {
    return {
      status: 'skipped',
      reason: 'post is newer than the redacted edit age threshold',
      postId,
    };
  }

  const review = reviewRedactedEditBody(getUpdatedBody(input));

  if (!review.shouldReport) {
    return {
      status: 'skipped',
      reason: review.reason,
      postId,
    };
  }

  const dedupeKey = `redacted-edit-reporter:reported:${postId}`;
  const alreadyReported = await redis.get(dedupeKey);

  if (alreadyReported) {
    return {
      status: 'skipped',
      reason: 'post was already reported by redacted edit reporter',
      postId,
    };
  }

  const post = await reddit.getPostById(postId);

  await reddit.report(post, {
    reason: REDACTED_EDIT_REPORT_REASON,
  });

  const expiration = new Date(Date.now() + DEDUPE_TTL_DAYS * DAY_IN_MS);

  await redis.set(dedupeKey, review.reason, { expiration });

  return {
    status: 'reported',
    reason: review.reason,
    postId,
  };
};
