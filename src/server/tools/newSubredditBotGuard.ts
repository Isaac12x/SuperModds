import type {
  CommentV2,
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  PostV2,
} from '@devvit/web/shared';
import { context, reddit, redis, settings } from '@devvit/web/server';
import {
  T1 as asT1ID,
  T2 as asT2ID,
  T3 as asT3ID,
  isT1 as isT1ID,
  isT2 as isT2ID,
  isT3 as isT3ID,
  type T1,
  type T2,
  type T3,
} from '@devvit/shared-types/tid.js';

export const NEW_SUBREDDIT_BOT_GUARD_REASON =
  'New subreddit bot guard: burst activity from low-trust account';

export const NEW_SUBREDDIT_BOT_GUARD_ENABLED_SETTING =
  'newSubredditBotGuardEnabled';
export const NEW_SUBREDDIT_BOT_GUARD_ACCOUNT_AGE_DAYS_SETTING =
  'newSubredditBotGuardAccountAgeDays';
export const NEW_SUBREDDIT_BOT_GUARD_MIN_KARMA_SETTING =
  'newSubredditBotGuardMinCombinedKarma';
export const NEW_SUBREDDIT_BOT_GUARD_FIRST_SEEN_HOURS_SETTING =
  'newSubredditBotGuardFirstSeenHours';
export const NEW_SUBREDDIT_BOT_GUARD_WINDOW_MINUTES_SETTING =
  'newSubredditBotGuardWindowMinutes';
export const NEW_SUBREDDIT_BOT_GUARD_MAX_ITEMS_SETTING =
  'newSubredditBotGuardMaxItemsPerWindow';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const HOUR_IN_MS = 60 * 60 * 1000;
const MINUTE_IN_MS = 60 * 1000;
const FIRST_SEEN_TTL_DAYS = 30;
const FILTER_DEDUPE_TTL_DAYS = 30;

const DEFAULT_ACCOUNT_AGE_DAYS = 7;
const DEFAULT_MIN_COMBINED_KARMA = 25;
const DEFAULT_FIRST_SEEN_HOURS = 24;
const DEFAULT_WINDOW_MINUTES = 10;
const DEFAULT_MAX_ITEMS_PER_WINDOW = 3;

type BotGuardResult = {
  status: 'filtered' | 'skipped';
  reason: string;
  thingId?: T1 | T3;
  username?: string;
};

type BotGuardSettings = {
  accountAgeDays: number;
  minCombinedKarma: number;
  firstSeenHours: number;
  windowMinutes: number;
  maxItemsPerWindow: number;
};

type SubmittedThing = {
  thingId: T1 | T3;
  username: string;
  authorId?: T2;
};

const getSettingNumber = async (settingName: string, fallback: number) => {
  const value = await settings.get(settingName);

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
};

const isBotGuardEnabled = async () => {
  const value = await settings.get(NEW_SUBREDDIT_BOT_GUARD_ENABLED_SETTING);

  return typeof value === 'boolean' ? value : true;
};

const getBotGuardSettings = async (): Promise<BotGuardSettings> => {
  const [
    accountAgeDays,
    minCombinedKarma,
    firstSeenHours,
    windowMinutes,
    maxItemsPerWindow,
  ] = await Promise.all([
    getSettingNumber(
      NEW_SUBREDDIT_BOT_GUARD_ACCOUNT_AGE_DAYS_SETTING,
      DEFAULT_ACCOUNT_AGE_DAYS
    ),
    getSettingNumber(
      NEW_SUBREDDIT_BOT_GUARD_MIN_KARMA_SETTING,
      DEFAULT_MIN_COMBINED_KARMA
    ),
    getSettingNumber(
      NEW_SUBREDDIT_BOT_GUARD_FIRST_SEEN_HOURS_SETTING,
      DEFAULT_FIRST_SEEN_HOURS
    ),
    getSettingNumber(
      NEW_SUBREDDIT_BOT_GUARD_WINDOW_MINUTES_SETTING,
      DEFAULT_WINDOW_MINUTES
    ),
    getSettingNumber(
      NEW_SUBREDDIT_BOT_GUARD_MAX_ITEMS_SETTING,
      DEFAULT_MAX_ITEMS_PER_WINDOW
    ),
  ]);

  return {
    accountAgeDays,
    minCombinedKarma,
    firstSeenHours,
    windowMinutes,
    maxItemsPerWindow,
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

const getPostAuthorId = (post: PostV2) => {
  if (!post.authorId) {
    return undefined;
  }

  if (isT2ID(post.authorId)) {
    return post.authorId;
  }

  return asT2ID(post.authorId);
};

const getSubmittedPost = async (
  post: PostV2 | undefined
): Promise<SubmittedThing | undefined> => {
  if (!post) {
    return undefined;
  }

  const thingId = getPostId(post);
  const authorId = getPostAuthorId(post);

  if (!thingId || !authorId) {
    return undefined;
  }

  const user = await reddit.getUserById(authorId);

  if (!user) {
    return undefined;
  }

  return {
    thingId,
    username: user.username,
    authorId,
  };
};

const getSubmittedComment = (
  comment: CommentV2 | undefined
): SubmittedThing | undefined => {
  if (!comment) {
    return undefined;
  }

  const thingId = getCommentId(comment);
  const username = comment.author.trim();

  if (!thingId || !username || username === '[deleted]') {
    return undefined;
  }

  return {
    thingId,
    username,
  };
};

const getFirstSeenMs = async (username: string, nowMs: number) => {
  const key = `new-subreddit-bot-guard:first-seen:${username.toLowerCase()}`;
  const existing = await redis.get(key);
  const parsed = existing ? Number.parseInt(existing, 10) : undefined;

  if (parsed && Number.isFinite(parsed)) {
    return parsed;
  }

  const expiration = new Date(nowMs + FIRST_SEEN_TTL_DAYS * DAY_IN_MS);

  await redis.set(key, String(nowMs), { expiration, nx: true });

  return nowMs;
};

const isLowTrustAuthor = async (
  submittedThing: SubmittedThing,
  botGuardSettings: BotGuardSettings,
  nowMs: number
) => {
  const user = submittedThing.authorId
    ? await reddit.getUserById(submittedThing.authorId)
    : await reddit.getUserByUsername(submittedThing.username);

  if (!user) {
    return {
      lowTrust: true,
      reason: 'author profile could not be loaded',
    };
  }

  const accountAgeMs = nowMs - user.createdAt.getTime();
  const combinedKarma = user.linkKarma + user.commentKarma;

  if (accountAgeMs <= botGuardSettings.accountAgeDays * DAY_IN_MS) {
    return {
      lowTrust: true,
      reason: `account is younger than ${botGuardSettings.accountAgeDays} days`,
    };
  }

  if (combinedKarma <= botGuardSettings.minCombinedKarma) {
    return {
      lowTrust: true,
      reason: `account has ${combinedKarma} combined karma`,
    };
  }

  return {
    lowTrust: false,
    reason: 'author is outside low-trust thresholds',
  };
};

const getActivityCount = async (
  username: string,
  windowMinutes: number,
  nowMs: number
) => {
  const windowMs = windowMinutes * MINUTE_IN_MS;
  const bucket = Math.floor(nowMs / windowMs);
  const key = `new-subreddit-bot-guard:activity:${username.toLowerCase()}:${bucket}`;
  const count = await redis.incrBy(key, 1);

  if (count === 1) {
    await redis.expire(key, Math.ceil((windowMs * 2) / 1000));
  }

  return count;
};

const filterBurstActivity = async (
  submittedThing: SubmittedThing,
  reason: string
): Promise<BotGuardResult> => {
  const dedupeKey = `new-subreddit-bot-guard:filtered:${submittedThing.thingId}`;
  const alreadyFiltered = await redis.get(dedupeKey);

  if (alreadyFiltered) {
    return {
      status: 'skipped',
      reason: 'content was already filtered by new subreddit bot guard',
      thingId: submittedThing.thingId,
      username: submittedThing.username,
    };
  }

  await reddit.filter(submittedThing.thingId, NEW_SUBREDDIT_BOT_GUARD_REASON, false);

  const expiration = new Date(Date.now() + FILTER_DEDUPE_TTL_DAYS * DAY_IN_MS);

  await redis.set(dedupeKey, reason, { expiration });

  return {
    status: 'filtered',
    reason,
    thingId: submittedThing.thingId,
    username: submittedThing.username,
  };
};

const handleSubmittedThing = async (
  submittedThing: SubmittedThing | undefined
): Promise<BotGuardResult> => {
  if (!(await isBotGuardEnabled())) {
    return {
      status: 'skipped',
      reason: 'new subreddit bot guard is disabled for this subreddit',
    };
  }

  if (!context.subredditName) {
    return {
      status: 'skipped',
      reason: 'subreddit context is unavailable',
    };
  }

  if (!submittedThing) {
    return {
      status: 'skipped',
      reason: 'submit event did not include a usable author and thing id',
    };
  }

  const botGuardSettings = await getBotGuardSettings();
  const nowMs = Date.now();
  const firstSeenMs = await getFirstSeenMs(submittedThing.username, nowMs);
  const firstSeenAgeMs = nowMs - firstSeenMs;

  if (firstSeenAgeMs > botGuardSettings.firstSeenHours * HOUR_IN_MS) {
    return {
      status: 'skipped',
      reason: 'author is outside the first-seen monitoring window',
      thingId: submittedThing.thingId,
      username: submittedThing.username,
    };
  }

  const trust = await isLowTrustAuthor(submittedThing, botGuardSettings, nowMs);

  if (!trust.lowTrust) {
    return {
      status: 'skipped',
      reason: trust.reason,
      thingId: submittedThing.thingId,
      username: submittedThing.username,
    };
  }

  const activityCount = await getActivityCount(
    submittedThing.username,
    botGuardSettings.windowMinutes,
    nowMs
  );

  if (activityCount <= botGuardSettings.maxItemsPerWindow) {
    return {
      status: 'skipped',
      reason: `${trust.reason}; activity count ${activityCount}/${botGuardSettings.maxItemsPerWindow}`,
      thingId: submittedThing.thingId,
      username: submittedThing.username,
    };
  }

  return filterBurstActivity(
    submittedThing,
    `${trust.reason}; submitted ${activityCount} items in ${botGuardSettings.windowMinutes} minutes`
  );
};

export const handleNewSubredditBotGuardPostSubmit = async (
  input: OnPostSubmitRequest
) => handleSubmittedThing(await getSubmittedPost(input.post));

export const handleNewSubredditBotGuardCommentSubmit = async (
  input: OnCommentSubmitRequest
) => handleSubmittedThing(getSubmittedComment(input.comment));
