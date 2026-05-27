import type {
  CommentV2,
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  PostV2,
} from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import {
  T1 as asT1ID,
  T3 as asT3ID,
  isT1 as isT1ID,
  isT3 as isT3ID,
  type T1,
  type T3,
} from '@devvit/shared-types/tid.js';
import type { Form } from '@devvit/shared-types/shared/form.js';

export const USER_WORKFLOW_BUILDER_REASON =
  'User workflow builder: moderator configured rule matched';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEDUPE_TTL_DAYS = 30;
const CONFIG_KEY = 'user-workflow-builder:config';

type WorkflowSurface = 'post' | 'comment' | 'subcomment';
type WorkflowAction = 'filter' | 'remove' | 'spam';

type WorkflowRule = {
  keywords: string[];
  action: WorkflowAction;
};

type WorkflowConfig = {
  enabled: boolean;
  posts: WorkflowRule;
  comments: WorkflowRule;
  subcomments: WorkflowRule;
};

type WorkflowFormValues = {
  enabled?: boolean;
  postKeywords?: string;
  postAction?: string[];
  commentKeywords?: string;
  commentAction?: string[];
  subcommentKeywords?: string;
  subcommentAction?: string[];
  joinWorkflowStatus?: string;
};

type WorkflowInput = {
  surface: WorkflowSurface;
  thingId: T1 | T3;
  text: string;
};

type WorkflowResult = {
  status: 'acted' | 'skipped' | 'error';
  reason: string;
  thingId?: T1 | T3;
  action?: WorkflowAction;
  surface?: WorkflowSurface;
};

const emptyRule = (): WorkflowRule => ({
  keywords: [],
  action: 'filter',
});

const emptyConfig = (): WorkflowConfig => ({
  enabled: false,
  posts: emptyRule(),
  comments: emptyRule(),
  subcomments: emptyRule(),
});

const normalizeKeywords = (value: string) =>
  value
    .split(/[\n,]/u)
    .map((keyword) => keyword.trim())
    .filter(Boolean);

const serializeKeywords = (keywords: string[]) => keywords.join('\n');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;

const getAction = (value: unknown, fallback: WorkflowAction): WorkflowAction => {
  const selected = getStringArray(value)?.[0];

  if (selected === 'filter' || selected === 'remove' || selected === 'spam') {
    return selected;
  }

  return fallback;
};

const parseRule = (value: unknown): WorkflowRule => {
  if (!isRecord(value)) {
    return emptyRule();
  }

  const keywords = getStringArray(value.keywords) ?? [];

  return {
    keywords,
    action: getAction([value.action], 'filter'),
  };
};

const parseConfig = (value: string | undefined): WorkflowConfig => {
  if (!value) {
    return emptyConfig();
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!isRecord(parsed)) {
      return emptyConfig();
    }

    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
      posts: parseRule(parsed.posts),
      comments: parseRule(parsed.comments),
      subcomments: parseRule(parsed.subcomments),
    };
  } catch {
    return emptyConfig();
  }
};

const getConfig = async () => parseConfig(await redis.get(CONFIG_KEY));

const saveConfig = async (config: WorkflowConfig) => {
  await redis.set(CONFIG_KEY, JSON.stringify(config));
};

const getThingIdFromPost = (post: PostV2 | undefined) => {
  const rawPostId = post?.id;

  if (!rawPostId) {
    return undefined;
  }

  return isT3ID(rawPostId) ? rawPostId : asT3ID(rawPostId);
};

const getThingIdFromComment = (comment: CommentV2 | undefined) => {
  const rawCommentId = comment?.id;

  if (!rawCommentId) {
    return undefined;
  }

  return isT1ID(rawCommentId) ? rawCommentId : asT1ID(rawCommentId);
};

const getCommentSurface = (comment: CommentV2) =>
  isT1ID(comment.parentId) ? 'subcomment' : 'comment';

const getPostInput = (
  post: PostV2 | undefined
): WorkflowInput | undefined => {
  if (!post) {
    return undefined;
  }

  const thingId = getThingIdFromPost(post);

  if (!thingId) {
    return undefined;
  }

  return {
    surface: 'post',
    thingId,
    text: [post.title, post.selftext, post.url].filter(Boolean).join('\n'),
  };
};

const getCommentInput = (
  comment: CommentV2 | undefined
): WorkflowInput | undefined => {
  if (!comment) {
    return undefined;
  }

  const thingId = getThingIdFromComment(comment);

  if (!thingId) {
    return undefined;
  }

  return {
    surface: getCommentSurface(comment),
    thingId,
    text: comment.body,
  };
};

const findMatchingKeyword = (text: string, keywords: string[]) => {
  const normalizedText = text.toLowerCase();

  return keywords.find((keyword) =>
    normalizedText.includes(keyword.toLowerCase())
  );
};

const getRule = (config: WorkflowConfig, surface: WorkflowSurface) => {
  if (surface === 'post') {
    return config.posts;
  }

  if (surface === 'comment') {
    return config.comments;
  }

  return config.subcomments;
};

const runAction = async (
  thingId: T1 | T3,
  action: WorkflowAction,
  reason: string
) => {
  if (action === 'filter') {
    await reddit.filter(thingId, reason, false);
    return;
  }

  await reddit.remove(thingId, action === 'spam');
};

const handleWorkflowInput = async (
  input: WorkflowInput | undefined
): Promise<WorkflowResult> => {
  if (!context.subredditName) {
    return {
      status: 'skipped',
      reason: 'subreddit context is unavailable',
    };
  }

  if (!input) {
    return {
      status: 'skipped',
      reason: 'submit event did not include a usable thing id',
    };
  }

  const config = await getConfig();

  if (!config.enabled) {
    return {
      status: 'skipped',
      reason: 'user workflow builder is disabled',
      thingId: input.thingId,
      surface: input.surface,
    };
  }

  const rule = getRule(config, input.surface);
  const keyword = findMatchingKeyword(input.text, rule.keywords);

  if (!keyword) {
    return {
      status: 'skipped',
      reason: `no ${input.surface} workflow keyword matched`,
      thingId: input.thingId,
      surface: input.surface,
    };
  }

  const dedupeKey = `user-workflow-builder:acted:${input.thingId}`;
  const alreadyHandled = await redis.get(dedupeKey);

  if (alreadyHandled) {
    return {
      status: 'skipped',
      reason: `${input.surface} was already handled by user workflow builder`,
      thingId: input.thingId,
      action: rule.action,
      surface: input.surface,
    };
  }

  const reason = `${USER_WORKFLOW_BUILDER_REASON}: ${input.surface} matched "${keyword}"`;

  await runAction(input.thingId, rule.action, reason);

  const expiration = new Date(Date.now() + DEDUPE_TTL_DAYS * DAY_IN_MS);

  await redis.set(dedupeKey, reason, { expiration });

  return {
    status: 'acted',
    reason,
    thingId: input.thingId,
    action: rule.action,
    surface: input.surface,
  };
};

const actionOptions = [
  {
    label: 'Filter to mod queue',
    value: 'filter',
  },
  {
    label: 'Remove',
    value: 'remove',
  },
  {
    label: 'Remove as spam',
    value: 'spam',
  },
];

const buildUserWorkflowForm = (config: WorkflowConfig): Form => ({
  title: 'Configure user workflows',
  description:
    'Create keyword workflows for posts, comments, and subcomments. Join workflows are listed as unavailable because Devvit Web does not currently expose a subreddit join trigger.',
  acceptLabel: 'Save workflows',
  cancelLabel: 'Cancel',
  fields: [
    {
      type: 'boolean',
      name: 'enabled',
      label: 'Enable content workflows',
      defaultValue: config.enabled,
      helpText: 'Applies the configured workflows to new posts, comments, and subcomments.',
    },
    {
      type: 'group',
      label: 'Posts',
      fields: [
        {
          type: 'paragraph',
          name: 'postKeywords',
          label: 'Post keywords',
          defaultValue: serializeKeywords(config.posts.keywords),
          helpText: 'One keyword per line, or comma-separated.',
        },
        {
          type: 'select',
          name: 'postAction',
          label: 'Post action',
          defaultValue: [config.posts.action],
          options: actionOptions,
        },
      ],
    },
    {
      type: 'group',
      label: 'Comments',
      fields: [
        {
          type: 'paragraph',
          name: 'commentKeywords',
          label: 'Top-level comment keywords',
          defaultValue: serializeKeywords(config.comments.keywords),
          helpText: 'Only comments whose parent is the post are treated as top-level comments.',
        },
        {
          type: 'select',
          name: 'commentAction',
          label: 'Top-level comment action',
          defaultValue: [config.comments.action],
          options: actionOptions,
        },
      ],
    },
    {
      type: 'group',
      label: 'Subcomments',
      fields: [
        {
          type: 'paragraph',
          name: 'subcommentKeywords',
          label: 'Subcomment keywords',
          defaultValue: serializeKeywords(config.subcomments.keywords),
          helpText: 'Replies to comments are treated as subcomments.',
        },
        {
          type: 'select',
          name: 'subcommentAction',
          label: 'Subcomment action',
          defaultValue: [config.subcomments.action],
          options: actionOptions,
        },
      ],
    },
    {
      type: 'paragraph',
      name: 'joinWorkflowStatus',
      label: 'User joining subreddit workflows',
      defaultValue:
        'Unavailable in this Devvit Web version: the current trigger list does not include subreddit subscribe/join events.',
      disabled: true,
    },
  ],
});

export const userWorkflowForm = buildUserWorkflowForm(emptyConfig());

export const openUserWorkflowForm = async () => buildUserWorkflowForm(await getConfig());

export const saveUserWorkflowForm = async (values: WorkflowFormValues) => {
  const config: WorkflowConfig = {
    enabled: values.enabled === true,
    posts: {
      keywords: normalizeKeywords(values.postKeywords ?? ''),
      action: getAction(values.postAction, 'filter'),
    },
    comments: {
      keywords: normalizeKeywords(values.commentKeywords ?? ''),
      action: getAction(values.commentAction, 'filter'),
    },
    subcomments: {
      keywords: normalizeKeywords(values.subcommentKeywords ?? ''),
      action: getAction(values.subcommentAction, 'filter'),
    },
  };

  await saveConfig(config);

  const ruleCount =
    config.posts.keywords.length +
    config.comments.keywords.length +
    config.subcomments.keywords.length;

  return {
    enabled: config.enabled,
    ruleCount,
  };
};

export const handleUserWorkflowPostSubmit = async (input: OnPostSubmitRequest) =>
  handleWorkflowInput(getPostInput(input.post));

export const handleUserWorkflowCommentSubmit = async (
  input: OnCommentSubmitRequest
) => handleWorkflowInput(getCommentInput(input.comment));
