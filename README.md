## Supermodds

Supermodds is a Devvit web moderator tool for Reddit communities. It provides a moderator dashboard custom post and registered server-side tools that can run from Reddit menu actions, forms, or Devvit triggers.

## Tools

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
