import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  OnPostUpdateRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import {
  handleCopyrightCommentSubmit,
  handleCopyrightPostSubmit,
} from '../tools/copyrightMaterialFilter';
import { handleRedactedPostUpdate } from '../tools/redactedEditReporter';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json<OnAppInstallRequest>();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Post created in subreddit ${context.subredditName} with id ${post.id} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to create post',
      },
      400
    );
  }
});

triggers.post('/on-post-submit', async (c) => {
  try {
    const input = await c.req.json<OnPostSubmitRequest>();
    const result = await handleCopyrightPostSubmit(input);

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Copyright material filter ${result.status}: ${result.reason}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error processing post submit: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to process post submit',
      },
      400
    );
  }
});

triggers.post('/on-comment-submit', async (c) => {
  try {
    const input = await c.req.json<OnCommentSubmitRequest>();
    const result = await handleCopyrightCommentSubmit(input);

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Copyright material filter ${result.status}: ${result.reason}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error processing comment submit: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to process comment submit',
      },
      400
    );
  }
});

triggers.post('/on-post-update', async (c) => {
  try {
    const input = await c.req.json<OnPostUpdateRequest>();
    const result = await handleRedactedPostUpdate(input);

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Redacted edit reporter ${result.status}: ${result.reason}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error processing post update: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to process post update',
      },
      400
    );
  }
});
