import type { Context } from 'hono';
import type { Form } from '@devvit/shared-types/shared/form.js';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import type { ModToolDescriptor } from '../../shared/modTools';
import { createPost } from '../core/post';
import { ADULT_IMAGE_FILTER_REASON } from './adultImageReviewFilter';
import { COPYRIGHT_FILTER_REASON } from './copyrightMaterialFilter';
import {
  REDACTED_EDIT_MIN_POST_AGE_DAYS,
  REDACTED_EDIT_REPORT_REASON,
} from './redactedEditReporter';
import { NEW_SUBREDDIT_BOT_GUARD_REASON } from './newSubredditBotGuard';
import { MODMAIL_SPAM_CLOSER_REASON } from './modmailSpamCloser';
import {
  openUserWorkflowForm,
  saveUserWorkflowForm,
  userWorkflowForm,
  USER_WORKFLOW_BUILDER_REASON,
} from './userWorkflowBuilder';
import {
  openPostFrequencyLimiterForm,
  postFrequencyLimiterForm,
  POST_FREQUENCY_LIMITER_REASON,
  savePostFrequencyLimiterForm,
} from './postFrequencyLimiter';
import {
  MODERATOR_PERMISSION_CHAIN_REASON,
  moderatorPermissionChainForm,
  openModeratorPermissionChainForm,
  saveModeratorPermissionChainForm,
} from './moderatorPermissionChain';

type ToolMenuAction = {
  endpoint: string;
  handle: (c: Context) => Promise<Response>;
};

type ToolFormAction = {
  name: string;
  endpoint: string;
  form: Form;
  handle: (c: Context) => Promise<Response>;
};

type RegisteredModTool = ModToolDescriptor & {
  menu?: ToolMenuAction;
  form?: ToolFormAction;
};

type StarterNoteFormValues = {
  message?: string;
};

type UserWorkflowFormValues = {
  enabled?: boolean;
  postKeywords?: string;
  postAction?: string[];
  commentKeywords?: string;
  commentAction?: string[];
  subcommentKeywords?: string;
  subcommentAction?: string[];
  joinWorkflowStatus?: string;
};

type PostFrequencyLimiterFormValues = {
  enabled?: boolean;
  maxPosts?: number;
  windowHours?: number;
};

type ModeratorPermissionChainFormValues = {
  enabled?: boolean;
  inactivityDays?: number;
  runCheckNow?: boolean;
};

const starterNoteForm: Form = {
  title: 'Create moderator note',
  description: 'Capture a note for this moderation workflow.',
  acceptLabel: 'Save note',
  cancelLabel: 'Cancel',
  fields: [
    {
      type: 'paragraph',
      name: 'message',
      label: 'Note',
      required: true,
      helpText: 'This starter action confirms the form pipeline is wired for future tools.',
    },
  ],
};

export const modTools: RegisteredModTool[] = [
  {
    id: 'create-post',
    title: 'Create Toolbox Post',
    description: 'Create the Devvit custom post that opens the moderator dashboard.',
    category: 'publishing',
    launchMode: 'menu',
    menu: {
      endpoint: '/internal/menu/create-post',
      handle: async () => {
        try {
          const post = await createPost();

          return Response.json(
            {
              navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
            } satisfies UiResponse,
            { status: 200 }
          );
        } catch (error) {
          console.error(`Error creating post: ${error}`);
          return Response.json(
            {
              showToast: 'Failed to create post',
            } satisfies UiResponse,
            { status: 400 }
          );
        }
      },
    },
  },
  {
    id: 'copyright-material-filter',
    title: 'Copyright Material Filter',
    description: `Uses the configured OpenAI API key to classify media posts and replies for copyright-review signals, then filters matches into the mod queue. Filter reason: ${COPYRIGHT_FILTER_REASON}.`,
    category: 'workflow',
    launchMode: 'trigger',
  },
  {
    id: 'adult-image-review-filter',
    title: '+18 Image Review Filter',
    description: `Uses the configured OpenAI API key to classify image posts and image replies for potential +18 content, then filters matches into the needs review queue. Filter reason: ${ADULT_IMAGE_FILTER_REASON}.`,
    category: 'workflow',
    launchMode: 'trigger',
  },
  {
    id: 'redacted-edit-reporter',
    title: 'Redacted Edit Reporter',
    description: `Automatically reports edits to posts older than ${REDACTED_EDIT_MIN_POST_AGE_DAYS} days when the new body contains no meaningful word content. Report reason: ${REDACTED_EDIT_REPORT_REASON}.`,
    category: 'workflow',
    launchMode: 'trigger',
  },
  {
    id: 'new-subreddit-bot-guard',
    title: 'New Subreddit Bot Guard',
    description: `Filters bursty posts and comments from newly seen, low-trust accounts into the mod queue. Filter reason: ${NEW_SUBREDDIT_BOT_GUARD_REASON}.`,
    category: 'workflow',
    launchMode: 'trigger',
  },
  {
    id: 'post-frequency-limiter',
    title: 'Post Frequency Limiter',
    description: `Restricts each user to the configured number of posts in a rolling time window, then filters excess posts into the mod queue. Open the form to configure the limit and time frame. Filter reason: ${POST_FREQUENCY_LIMITER_REASON}.`,
    category: 'workflow',
    launchMode: 'form',
    menu: {
      endpoint: '/internal/menu/post-frequency-limiter',
      handle: async () =>
        Response.json(
          {
            showForm: {
              name: 'postFrequencyLimiterForm',
              form: await openPostFrequencyLimiterForm(),
            },
          } satisfies UiResponse,
          { status: 200 }
        ),
    },
    form: {
      name: 'postFrequencyLimiterForm',
      endpoint: '/internal/form/postFrequencyLimiterForm',
      form: postFrequencyLimiterForm,
      handle: async (c) => {
        const values = await c.req.json<PostFrequencyLimiterFormValues>();
        const config = await savePostFrequencyLimiterForm(values);

        return Response.json(
          {
            showToast: config.enabled
              ? `Post limiter enabled: ${config.maxPosts} posts per ${config.windowHours} hours`
              : 'Post limiter disabled',
          } satisfies UiResponse,
          { status: 200 }
        );
      },
    },
  },
  {
    id: 'moderator-permission-chain',
    title: 'Moderator Permission Chain',
    description: `Assigns full moderator permissions to a remaining moderator when no current moderator has full permissions, or when all current moderators are inactive for the configured period. Assignment reason: ${MODERATOR_PERMISSION_CHAIN_REASON}.`,
    category: 'workflow',
    launchMode: 'form',
    menu: {
      endpoint: '/internal/menu/moderator-permission-chain',
      handle: async () =>
        Response.json(
          {
            showForm: {
              name: 'moderatorPermissionChainForm',
              form: await openModeratorPermissionChainForm(),
            },
          } satisfies UiResponse,
          { status: 200 }
        ),
    },
    form: {
      name: 'moderatorPermissionChainForm',
      endpoint: '/internal/form/moderatorPermissionChainForm',
      form: moderatorPermissionChainForm,
      handle: async (c) => {
        const values = await c.req.json<ModeratorPermissionChainFormValues>();
        const saved = await saveModeratorPermissionChainForm(values);
        const suffix = saved.result
          ? `; check ${saved.result.status}: ${saved.result.reason}`
          : '';

        return Response.json(
          {
            showToast: saved.config.enabled
              ? `Moderator permission chain enabled for ${saved.config.inactivityDays} days${suffix}`
              : `Moderator permission chain disabled${suffix}`,
          } satisfies UiResponse,
          { status: 200 }
        );
      },
    },
  },
  {
    id: 'modmail-spam-closer',
    title: 'Modmail Spam Closer',
    description: `Automatically archives bot appeals and spammy modmail conversations from user participants, leaving an internal audit note. Close reason: ${MODMAIL_SPAM_CLOSER_REASON}.`,
    category: 'workflow',
    launchMode: 'trigger',
  },
  {
    id: 'user-workflow-builder',
    title: 'User Workflow Builder',
    description: `Lets moderators configure keyword workflows for posts, top-level comments, and subcomments. Matching content can be filtered, removed, or removed as spam. Join workflows are not available because current Devvit Web triggers do not include subreddit join events. Default reason: ${USER_WORKFLOW_BUILDER_REASON}.`,
    category: 'workflow',
    launchMode: 'form',
    menu: {
      endpoint: '/internal/menu/user-workflow-builder',
      handle: async () =>
        Response.json(
          {
            showForm: {
              name: 'userWorkflowForm',
              form: await openUserWorkflowForm(),
            },
          } satisfies UiResponse,
          { status: 200 }
        ),
    },
    form: {
      name: 'userWorkflowForm',
      endpoint: '/internal/form/userWorkflowForm',
      form: userWorkflowForm,
      handle: async (c) => {
        const values = await c.req.json<UserWorkflowFormValues>();
        const result = await saveUserWorkflowForm(values);

        return Response.json(
          {
            showToast: result.enabled
              ? `User workflows enabled with ${result.ruleCount} keywords`
              : `User workflows disabled with ${result.ruleCount} saved keywords`,
          } satisfies UiResponse,
          { status: 200 }
        );
      },
    },
  },
  {
    id: 'starter-note',
    title: 'Starter Form Action',
    description: 'A minimal registered form tool to use as the pattern for future mod actions.',
    category: 'workflow',
    launchMode: 'form',
    menu: {
      endpoint: '/internal/menu/starter-note',
      handle: async () =>
        Response.json(
          {
            showForm: {
              name: 'starterNoteForm',
              form: starterNoteForm,
            },
          } satisfies UiResponse,
          { status: 200 }
        ),
    },
    form: {
      name: 'starterNoteForm',
      endpoint: '/internal/form/starterNoteForm',
      form: starterNoteForm,
      handle: async (c) => {
        const { message } = await c.req.json<StarterNoteFormValues>();
        const trimmedMessage = typeof message === 'string' ? message.trim() : '';

        return Response.json(
          {
            showToast: trimmedMessage
              ? `Moderator note saved: ${trimmedMessage}`
              : 'Moderator note saved',
          } satisfies UiResponse,
          { status: 200 }
        );
      },
    },
  },
];

export const modToolDescriptors: ModToolDescriptor[] = modTools.map(
  ({ id, title, description, category, launchMode }) => ({
    id,
    title,
    description,
    category,
    launchMode,
  })
);

export const findModTool = (toolId: string) =>
  modTools.find((tool) => tool.id === toolId);

export const findModToolByFormName = (formName: string) =>
  modTools.find((tool) => tool.form?.name === formName);
