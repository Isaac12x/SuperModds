import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { findModToolByFormName } from '../tools/registry';

export const forms = new Hono();

forms.post('/:formName', async (c) => {
  const formName = c.req.param('formName');
  const tool = findModToolByFormName(formName);

  if (!tool?.form) {
    return c.json<UiResponse>(
      {
        showToast: `Unknown moderator form: ${formName}`,
      },
      404
    );
  }

  return await tool.form.handle(c);
});
