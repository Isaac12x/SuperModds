import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentSubmitRequest,
  OnModMailRequest,
  OnPostSubmitRequest,
  OnPostUpdateRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import {
  handleAdultImageCommentSubmit,
  handleAdultImagePostSubmit,
} from '../tools/adultImageReviewFilter';
import {
  handleCopyrightCommentSubmit,
  handleCopyrightPostSubmit,
} from '../tools/copyrightMaterialFilter';
import {
  handleNewSubredditBotGuardCommentSubmit,
  handleNewSubredditBotGuardPostSubmit,
} from '../tools/newSubredditBotGuard';
import { handlePostFrequencyLimiterPostSubmit } from '../tools/postFrequencyLimiter';
import { handleModmailSpamCloser } from '../tools/modmailSpamCloser';
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
    const frequencyLimitResult = await handlePostFrequencyLimiterPostSubmit(input);

    if (frequencyLimitResult.status === 'filtered') {
      return c.json<TriggerResponse>(
        {
          status: 'success',
          message: `Post frequency limiter filtered: ${frequencyLimitResult.reason}`,
        },
        200
      );
    }

    const botGuardResult = await handleNewSubredditBotGuardPostSubmit(input);

    if (botGuardResult.status === 'filtered') {
      return c.json<TriggerResponse>(
        {
          status: 'success',
          message: `New subreddit bot guard filtered: ${botGuardResult.reason}`,
        },
        200
      );
    }

    const [copyrightResult, adultImageResult] = await Promise.all([
      handleCopyrightPostSubmit(input),
      handleAdultImagePostSubmit(input),
    ]);

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message:
          `Post frequency limiter ${frequencyLimitResult.status}: ${frequencyLimitResult.reason}; ` +
          `New subreddit bot guard ${botGuardResult.status}: ${botGuardResult.reason}; ` +
          `Copyright material filter ${copyrightResult.status}: ${copyrightResult.reason}; ` +
          `+18 image review filter ${adultImageResult.status}: ${adultImageResult.reason}`,
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
    const botGuardResult = await handleNewSubredditBotGuardCommentSubmit(input);

    if (botGuardResult.status === 'filtered') {
      return c.json<TriggerResponse>(
        {
          status: 'success',
          message: `New subreddit bot guard filtered: ${botGuardResult.reason}`,
        },
        200
      );
    }

    const [copyrightResult, adultImageResult] = await Promise.all([
      handleCopyrightCommentSubmit(input),
      handleAdultImageCommentSubmit(input),
    ]);

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message:
          `New subreddit bot guard ${botGuardResult.status}: ${botGuardResult.reason}; ` +
          `Copyright material filter ${copyrightResult.status}: ${copyrightResult.reason}; ` +
          `+18 image review filter ${adultImageResult.status}: ${adultImageResult.reason}`,
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

triggers.post('/on-modmail', async (c) => {
  try {
    const input = await c.req.json<OnModMailRequest>();
    const result = await handleModmailSpamCloser(input);

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Modmail spam closer ${result.status}: ${result.reason}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error processing modmail: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to process modmail',
      },
      400
    );
  }
});
