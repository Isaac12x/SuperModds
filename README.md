## Supermodds

Supermodds is a Devvit web moderator tool for Reddit communities. It provides a moderator dashboard custom post and registered server-side tools that can run from Reddit menu actions, forms, or Devvit triggers.

## Tools

### Copyright Material Filter

The Copyright Material Filter is an automatic moderation trigger for media copyright review.

It listens for Reddit `PostSubmit` and `CommentSubmit` events. When submitted content contains uploaded media or media URLs, Supermodds sends the post or reply metadata to the configured OpenAI Responses API model for copyright classification. If the provider returns a likely copyright-review match, Supermodds filters the content into the mod queue with this reason:

```text
Possible copyrighted media: review required
```

Current detection flow:

- Text-only content is skipped before calling the external API.
- Media posts and replies are classified by OpenAI using the title, body, provider metadata, and media URLs available in the Devvit trigger payload.
- A post or reply is filtered at most once by this tool within the 30-day dedupe window.
- Moderators can disable the tool per subreddit with the `copyrightMaterialFilterEnabled` setting.

To configure the external API, set the global secret `openaiApiKey` after the app has been built and installed:

```sh
npx devvit settings set openaiApiKey
```

The default model is configured by the global `copyrightScanModel` setting.

### Redacted Edit Reporter

The Redacted Edit Reporter is an automatic moderation trigger for mass post-redaction edits.

It listens for Reddit `PostUpdate` events and reports older posts when the edited body no longer contains meaningful word content. This is intended for cases where a tool such as `redacted` edits large numbers of old posts into non-word content, creating moderator queue pressure.

When a matching edit is detected, Supermodds reports the post with this reason:

```text
Not allowed changes: moderator rejected
```

Current detection rules:

- The post must be at least 7 days old.
- The updated post body is empty, or it has fewer than 3 meaningful words and is mostly non-word content.
- A post is reported at most once by this tool within the 30-day dedupe window.

The tool does not remove, spam, approve, or edit posts. It only places matching posts into the moderation review flow by reporting them.

## How to Use

1. Install or deploy the Devvit app to the subreddit.
2. Make sure the app has moderator Reddit API permissions.
3. The `onPostUpdate` trigger is registered in `devvit.json`, so the Redacted Edit Reporter runs automatically after deployment.
4. Review matching posts in the subreddit mod queue under the report reason `Not allowed changes: moderator rejected`.
5. Use the Supermodds dashboard post to confirm the tool is registered as `redacted-edit-reporter`.

No moderator menu click is required for the Redacted Edit Reporter. It is an automatic trigger-backed tool.

## Fetch Domains

The following domains are requested for this app:

- `api.openai.com` - Used server-side by the Copyright Material Filter to classify submitted media posts and replies for copyright-review signals before routing matches to the mod queue.

## Tech Stack

- [Devvit](https://developers.reddit.com/): Reddit developer platform
- [Vite](https://vite.dev/): Client and server builds
- [React](https://react.dev/): Dashboard UI
- [Hono](https://hono.dev/): Backend routes
- [Tailwind](https://tailwindcss.com/): Styles
- [TypeScript](https://www.typescriptlang.org/): Type safety

## Getting Started

> Make sure you have Node 22 installed before running the app.

1. Run `npm install`.
2. Run `npm run login` to connect the Devvit CLI to Reddit.
3. Run `npm run dev` to start a playtest session.
4. Run `npm run deploy` to upload a new app version.

## Commands

- `npm run dev`: Starts a development server where you can develop your application live on Reddit.
- `npm run build`: Builds your client and server projects
- `npm run deploy`: Uploads a new version of your app
- `npm run launch`: Publishes your app for review
- `npm run login`: Logs your CLI into Reddit
- `npm run type-check`: Checks TypeScript types
- `npm run lint`: Checks lint rules
