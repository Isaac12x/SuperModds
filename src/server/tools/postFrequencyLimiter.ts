import type { OnPostSubmitRequest, PostV2 } from '@devvit/web/shared';
import { context, reddit, redis, settings } from '@devvit/web/server';
import type { Form } from '@devvit/shared-types/shared/form.js';
import {
  T2 as asT2ID,
  T3 as asT3ID,
  isT2 as isT2ID,
  isT3 as isT3ID,
  type T2,
  type T3,
} from '@devvit/shared-types/tid.js';

export const POST_FREQUENCY_LIMITER_REASON =
  'Post frequency limiter: user exceeded subreddit posting limit';

export const POST_FREQUENCY_LIMITER_ENABLED_SETTING =
  'postFrequencyLimiterEnabled';
export const POST_FREQUENCY_LIMITER_MAX_POSTS_SETTING =
  'postFrequencyLimiterMaxPosts';
export const POST_FREQUENCY_LIMITER_WINDOW_HOURS_SETTING =
  'postFrequencyLimiterWindowHours';

const HOUR_IN_MS = 60 * 60 * 1000;

const DEFAULT_MAX_POSTS = 3;
const DEFAULT_WINDOW_HOURS = 24;
const CONFIG_KEY = 'post-frequency-limiter:config';

type FrequencyLimitResult = {
  status: 'filtered' | 'skipped';
  reason: string;
  thingId?: T3;
  username?: string;
};

type FrequencyLimiterSettings = {
  enabled: boolean;
  maxPosts: number;
  windowHours: number;
};

type FrequencyLimiterFormValues = {
  enabled?: boolean;
  maxPosts?: number;
  windowHours?: number;
};

type SubmittedPost = {
  thingId: T3;
  username: string;
};

const getSettingNumber = async (settingName: string, fallback: number) => {
  const value = await settings.get(settingName);

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
};

const isPostFrequencyLimiterEnabled = async () => {
  const value = await settings.get(POST_FREQUENCY_LIMITER_ENABLED_SETTING);

  return typeof value === 'boolean' ? value : true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveInteger = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;

const parseConfig = (
  value: string | undefined,
  fallback: FrequencyLimiterSettings
): FrequencyLimiterSettings => {
  if (!value) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!isRecord(parsed)) {
      return fallback;
    }

    return {
      enabled:
        typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
      maxPosts: positiveInteger(parsed.maxPosts, fallback.maxPosts),
      windowHours: positiveInteger(parsed.windowHours, fallback.windowHours),
    };
  } catch {
    return fallback;
  }
};

const getFrequencyLimiterSettings =
  async (): Promise<FrequencyLimiterSettings> => {
    const [enabled, maxPosts, windowHours] = await Promise.all([
      isPostFrequencyLimiterEnabled(),
      getSettingNumber(
        POST_FREQUENCY_LIMITER_MAX_POSTS_SETTING,
        DEFAULT_MAX_POSTS
      ),
      getSettingNumber(
        POST_FREQUENCY_LIMITER_WINDOW_HOURS_SETTING,
        DEFAULT_WINDOW_HOURS
      ),
    ]);

    const settingsConfig = {
      enabled,
      maxPosts,
      windowHours,
    };

    return parseConfig(await redis.get(CONFIG_KEY), settingsConfig);
  };

const saveConfig = async (config: FrequencyLimiterSettings) => {
  await redis.set(CONFIG_KEY, JSON.stringify(config));
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
): Promise<SubmittedPost | undefined> => {
  if (!post) {
    return undefined;
  }

  const thingId = getPostId(post);
  const authorId: T2 | undefined = getPostAuthorId(post);

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
  };
};

const getPostLogKey = (subredditName: string, username: string) =>
  `post-frequency-limiter:${subredditName.toLowerCase()}:${username.toLowerCase()}:posts`;

const recordPostAndGetCount = async (
  submittedPost: SubmittedPost,
  subredditName: string,
  windowHours: number,
  nowMs: number
) => {
  const key = getPostLogKey(subredditName, submittedPost.username);
  const windowMs = windowHours * HOUR_IN_MS;
  const cutoffMs = nowMs - windowMs;

  await redis.zRemRangeByScore(key, 0, cutoffMs);
  await redis.zAdd(key, {
    member: submittedPost.thingId,
    score: nowMs,
  });
  await redis.expire(key, Math.ceil((windowMs * 2) / 1000));

  return await redis.zCard(key);
};

const filterPost = async (
  submittedPost: SubmittedPost,
  reason: string
): Promise<FrequencyLimitResult> => {
  const dedupeKey = `post-frequency-limiter:filtered:${submittedPost.thingId}`;
  const alreadyFiltered = await redis.get(dedupeKey);

  if (alreadyFiltered) {
    return {
      status: 'skipped',
      reason: 'post was already filtered by post frequency limiter',
      thingId: submittedPost.thingId,
      username: submittedPost.username,
    };
  }

  await reddit.filter(submittedPost.thingId, POST_FREQUENCY_LIMITER_REASON, false);

  await redis.set(dedupeKey, reason, {
    expiration: new Date(Date.now() + 30 * 24 * HOUR_IN_MS),
  });

  return {
    status: 'filtered',
    reason,
    thingId: submittedPost.thingId,
    username: submittedPost.username,
  };
};

const handleSubmittedPost = async (
  submittedPost: SubmittedPost | undefined
): Promise<FrequencyLimitResult> => {
  const limiterSettings = await getFrequencyLimiterSettings();

  if (!limiterSettings.enabled) {
    return {
      status: 'skipped',
      reason: 'post frequency limiter is disabled for this subreddit',
    };
  }

  if (!context.subredditName) {
    return {
      status: 'skipped',
      reason: 'subreddit context is unavailable',
    };
  }

  if (!submittedPost) {
    return {
      status: 'skipped',
      reason: 'post submit event did not include a usable author and post id',
    };
  }

  const postCount = await recordPostAndGetCount(
    submittedPost,
    context.subredditName,
    limiterSettings.windowHours,
    Date.now()
  );

  if (postCount <= limiterSettings.maxPosts) {
    return {
      status: 'skipped',
      reason: `author submitted ${postCount}/${limiterSettings.maxPosts} posts in ${limiterSettings.windowHours} hours`,
      thingId: submittedPost.thingId,
      username: submittedPost.username,
    };
  }

  return filterPost(
    submittedPost,
    `author submitted ${postCount} posts in ${limiterSettings.windowHours} hours; limit is ${limiterSettings.maxPosts}`
  );
};

export const handlePostFrequencyLimiterPostSubmit = async (
  input: OnPostSubmitRequest
) => handleSubmittedPost(await getSubmittedPost(input.post));

const buildPostFrequencyLimiterForm = (
  config: FrequencyLimiterSettings
): Form => ({
  title: 'Configure post frequency limiter',
  description:
    'Restrict each user to a configured number of posts inside a rolling subreddit-specific time window.',
  acceptLabel: 'Save limiter',
  cancelLabel: 'Cancel',
  fields: [
    {
      type: 'boolean',
      name: 'enabled',
      label: 'Enable post frequency limiter',
      defaultValue: config.enabled,
      helpText: 'Filters excess posts into the mod queue.',
    },
    {
      type: 'number',
      name: 'maxPosts',
      label: 'Maximum posts per user',
      defaultValue: config.maxPosts,
      helpText: 'The number of posts allowed before new posts are filtered.',
    },
    {
      type: 'number',
      name: 'windowHours',
      label: 'Rolling window in hours',
      defaultValue: config.windowHours,
      helpText: 'The time period used for counting each user\'s posts.',
    },
  ],
});

export const postFrequencyLimiterForm = buildPostFrequencyLimiterForm({
  enabled: true,
  maxPosts: DEFAULT_MAX_POSTS,
  windowHours: DEFAULT_WINDOW_HOURS,
});

export const openPostFrequencyLimiterForm = async () =>
  buildPostFrequencyLimiterForm(await getFrequencyLimiterSettings());

export const savePostFrequencyLimiterForm = async (
  values: FrequencyLimiterFormValues
) => {
  const config = {
    enabled: values.enabled === true,
    maxPosts: positiveInteger(values.maxPosts, DEFAULT_MAX_POSTS),
    windowHours: positiveInteger(values.windowHours, DEFAULT_WINDOW_HOURS),
  };

  await saveConfig(config);

  return config;
};
