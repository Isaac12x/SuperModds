import type { Context } from 'hono';
import type { Form } from '@devvit/shared-types/shared/form.js';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import type { ModToolDescriptor } from '../../shared/modTools';
import { createPost } from '../core/post';
import { COPYRIGHT_FILTER_REASON } from './copyrightMaterialFilter';
import {
  REDACTED_EDIT_MIN_POST_AGE_DAYS,
  REDACTED_EDIT_REPORT_REASON,
} from './redactedEditReporter';

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
    id: 'redacted-edit-reporter',
    title: 'Redacted Edit Reporter',
    description: `Automatically reports edits to posts older than ${REDACTED_EDIT_MIN_POST_AGE_DAYS} days when the new body contains no meaningful word content. Report reason: ${REDACTED_EDIT_REPORT_REASON}.`,
    category: 'workflow',
    launchMode: 'trigger',
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
