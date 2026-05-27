import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { InitResponse, ToolsResponse } from '../../shared/modTools';
import { modToolDescriptors } from '../tools/registry';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

api.get('/init', async (c) => {
  try {
    const username = await reddit.getCurrentUsername();

    return c.json<InitResponse>({
      type: 'init',
      username: username ?? 'anonymous',
      subredditName: context.subredditName ?? null,
    });
  } catch (error) {
    console.error('API Init Error:', error);
    let errorMessage = 'Unknown error during initialization';
    if (error instanceof Error) {
      errorMessage = `Initialization failed: ${error.message}`;
    }
    return c.json<ErrorResponse>(
      { status: 'error', message: errorMessage },
      400
    );
  }
});

api.get('/tools', (c) => {
  return c.json<ToolsResponse>({
    type: 'tools',
    tools: modToolDescriptors,
  });
});
