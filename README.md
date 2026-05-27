## Supermodds

Supermodds is a Devvit web app for Reddit moderators. It creates a custom
dashboard post, exposes a registered-tool dashboard, and runs server-side
moderation workflows from Reddit menu actions, forms, and Devvit triggers.

The app is built for Reddit's Devvit web runtime:

- Inline view: `src/client/splash.html`
- Expanded dashboard view: `src/client/game.html`
- Server entrypoint: `src/server/index.ts`
- Tool registry: `src/server/tools/registry.ts`

## Current Functionality

### Moderator Dashboard Post

Supermodds creates a Devvit custom post titled `supermodds`.

The inline view shows the app name and an `Open tools` button. The expanded
dashboard loads the current moderator username, subreddit name, and registered
tool list from `/api/init` and `/api/tools`.

The dashboard displays each registered tool's category, launch mode, title,
description, and registry id.

### Create Toolbox Post

Menu action: `Create Supermodds post`

This subreddit moderator menu action creates a new Supermodds custom post and
navigates the moderator to it. The app also creates this custom post
automatically when the app is installed through the `onAppInstall` trigger.

### Starter Form Action

Menu action: `Create moderator note`

This is a minimal registered form workflow used as the pattern for future
moderator actions. The menu action opens `starterNoteForm`; submitting the form
trims the note text and shows a confirmation toast.

This workflow does not persist notes yet. It verifies that Devvit menu and form
plumbing is wired.

### Copyright Material Filter

Trigger events: `PostSubmit`, `CommentSubmit`

The Copyright Material Filter reviews submitted posts and comments for likely
copyrighted media that should go to the mod queue for human review.

Current behavior:

- Skips content that has no native media, known media link, or media file URL.
- Reviews title, body, media metadata, provider metadata, and URLs.
- Sends candidates to the configured OpenAI Responses API model.
- Filters matching posts or comments with this reason:

```text
Possible copyrighted media: review required
```

- Deduplicates filtered content for 30 days in Redis.
- Can be disabled per subreddit with `copyrightMaterialFilterEnabled`.

Configuration:

- Global secret `openaiApiKey`: OpenAI API key used for scans.
- Global setting `copyrightScanModel`: model used for copyright scans.

### +18 Image Review Filter

Trigger events: `PostSubmit`, `CommentSubmit`

The +18 Image Review Filter reviews submitted image posts and image comments for
potential adult image content that should go to the needs-review queue.

Current behavior:

- Supports image URLs from native image posts, thumbnails, media URLs, gallery
  images, oEmbed thumbnails, and comment media URLs.
- Recognizes common image file extensions and known image hosts.
- Sends up to 4 unique image URLs per submission to the configured OpenAI
  Responses API model.
- Filters matching posts or comments with this reason:

```text
Potential +18 image content: review required
```

- Deduplicates filtered content for 30 days in Redis.
- Can be disabled per subreddit with `adultImageReviewFilterEnabled`.

Configuration:

- Global secret `openaiApiKey`: OpenAI API key used for scans.
- Global setting `adultImageScanModel`: model used for +18 image scans.

### New Subreddit Bot Guard

Trigger events: `PostSubmit`, `CommentSubmit`

The New Subreddit Bot Guard filters bursty activity from newly seen, low-trust
accounts into the mod queue.

Current behavior:

- Tracks the first time an author is seen in Redis for 30 days.
- Only watches authors inside the configured first-seen monitoring window.
- Treats an author as low-trust when their profile cannot be loaded, their
  account is under the account-age threshold, or their combined karma is at or
  below the combined-karma threshold.
- Counts posts and comments in a configured rolling activity bucket.
- Filters content when the author exceeds the configured activity limit.
- Filters matching posts or comments with this reason:

```text
New subreddit bot guard: burst activity from low-trust account
```

- Deduplicates filtered content for 30 days in Redis.
- Runs before the OpenAI-backed filters. If it filters the submission, the other
  submit-trigger filters are skipped for that event.

Configuration:

- `newSubredditBotGuardEnabled`: enables or disables the guard.
- `newSubredditBotGuardAccountAgeDays`: account-age threshold in days.
- `newSubredditBotGuardMinCombinedKarma`: combined-karma threshold.
- `newSubredditBotGuardFirstSeenHours`: first-seen monitoring window in hours.
- `newSubredditBotGuardWindowMinutes`: activity-count window in minutes.
- `newSubredditBotGuardMaxItemsPerWindow`: allowed items per activity window.

### Redacted Edit Reporter

Trigger event: `PostUpdate`

The Redacted Edit Reporter reports older posts when an edit removes meaningful
word content. It is intended for mass redaction edits that replace old post
bodies with empty or mostly non-word content.

Current behavior:

- Only reviews posts at least 7 days old.
- Reports an edit when the updated body is empty.
- Reports an edit when the updated body has fewer than 3 meaningful words and is
  mostly non-word content.
- Reports matching posts with this reason:

```text
Not allowed changes: moderator rejected
```

- Deduplicates reported posts for 30 days in Redis.
- Does not remove, spam, approve, or edit posts.

### Modmail Spam Closer

Trigger event: `ModMail`

The Modmail Spam Closer archives bot appeals and spammy subreddit-to-user
modmail conversations from user participants.

Current behavior:

- Only processes latest messages from user participants.
- Skips non-subreddit-to-user conversations and already archived conversations.
- Loads the conversation, marks it read, and reviews participant messages.
- Closes appeals from shadowbanned or suspended accounts.
- Closes autogenerated appeals that match bot, spam, shadowban, suspension, or
  account-restoration language.
- Closes conversations that match spam signals such as off-platform contact,
  crypto/investment spam, account/upvote/karma sales, backlink offers, and links.
- Adds an internal hidden-author audit note before archiving:

```text
Modmail spam closer: automated appeal or spam conversation
```

- Deduplicates closed conversations for 30 days in Redis.
- Can be disabled per subreddit with `modmailSpamCloserEnabled`.

## Registered Entrypoints

The Devvit app configuration in `devvit.json` currently registers:

- Custom post inline entrypoint: `splash.html`
- Custom post expanded entrypoint: `game.html`
- Server entrypoint: `index.cjs`
- Subreddit moderator menu actions:
  - `Create Supermodds post`
  - `Create moderator note`
- Form:
  - `starterNoteForm`
- Triggers:
  - `onAppInstall`
  - `onPostSubmit`
  - `onCommentSubmit`
  - `onPostUpdate`
  - `onModMail`

## Settings

Global settings:

- `openaiApiKey`: secret OpenAI API key for OpenAI-backed moderation scans.
- `copyrightScanModel`: model for the Copyright Material Filter.
- `adultImageScanModel`: model for the +18 Image Review Filter.

Subreddit settings:

- `copyrightMaterialFilterEnabled`
- `adultImageReviewFilterEnabled`
- `newSubredditBotGuardEnabled`
- `newSubredditBotGuardAccountAgeDays`
- `newSubredditBotGuardMinCombinedKarma`
- `newSubredditBotGuardFirstSeenHours`
- `newSubredditBotGuardWindowMinutes`
- `newSubredditBotGuardMaxItemsPerWindow`
- `modmailSpamCloserEnabled`

To set the OpenAI API key after the app is built and installed:

```sh
npx devvit settings set openaiApiKey
```

## Permissions And Fetch Domains

The app requests moderator Reddit API permissions because it creates custom
posts, reads subreddit/user context, filters posts and comments, reports posts,
and manages matching modmail conversations.

The app requests HTTP access to:

- `api.openai.com`: used server-side by the Copyright Material Filter and +18
  Image Review Filter through the OpenAI Responses API.

## Tech Stack

- [Devvit](https://developers.reddit.com/): Reddit developer platform
- [Vite](https://vite.dev/): client and server builds
- [React](https://react.dev/): dashboard UI
- [Hono](https://hono.dev/): backend routes
- [Tailwind CSS](https://tailwindcss.com/): styles
- [TypeScript](https://www.typescriptlang.org/): type safety

## Getting Started

Make sure Node 22 is installed before running the app.

1. Run `npm install`.
2. Run `npm run login` to connect the Devvit CLI to Reddit.
3. Run `npm run dev` to start a playtest session.
4. Run `npm run deploy` to upload a new app version.

## Commands

- `npm run dev`: starts a Devvit playtest session.
- `npm run build`: builds the client and server projects.
- `npm run deploy`: runs type-checking, linting, and uploads a new app version.
- `npm run launch`: deploys and publishes the app for review.
- `npm run login`: logs the Devvit CLI into Reddit.
- `npm run type-check`: checks TypeScript types.
- `npm run lint`: checks lint rules.
- `npm run prettier`: formats the project.
