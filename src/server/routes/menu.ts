import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { findModTool } from '../tools/registry';

export const menu = new Hono();

menu.post('/:toolId', async (c) => {
  const toolId = c.req.param('toolId');
  const tool = findModTool(toolId);

  if (!tool) {
    return c.json<UiResponse>(
      {
        showToast: `Unknown moderator tool: ${toolId}`,
      },
      404
    );
  }

  return await tool.menu.handle(c);
});
