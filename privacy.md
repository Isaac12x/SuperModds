# Privacy Policy

Last updated: May 28, 2026

Supermodds is a Reddit Devvit application for subreddit moderators. This policy
explains what information the app processes, why it is processed, and how it is
handled.

This policy applies to the Supermodds app running on Reddit through Devvit. It
does not replace Reddit's own privacy policy or the policies of any subreddit
where the app is installed.

## Information We Process

Supermodds may process information made available to the app by Reddit and the
subreddit moderators who install or use it, including:

- Reddit post, comment, author, subreddit, and moderation event data needed to
  run configured moderation workflows.
- Moderator usernames and subreddit names needed to display and operate the
  moderator dashboard.
- App settings configured by moderators, including enabled tools, thresholds,
  and model names.
- Moderator-provided form submissions used to configure workflows.
- Redis records used to support deduplication, rate limiting, activity windows,
  and workflow configuration.
- A global OpenAI API key if a moderator or app administrator configures one in
  Devvit settings.

Supermodds does not intentionally collect information from outside Reddit and
does not ask users to provide personal information directly to the app.

## How Information Is Used

Supermodds uses processed information to:

- Create and display a moderator dashboard post.
- Run moderation workflows configured for a subreddit.
- Filter, report, or route posts and comments for moderator review when a
  configured rule matches.
- Track short-lived state needed for deduplication, rate limiting, bot-guard
  checks, and moderator workflow configuration.
- Display confirmations, forms, and moderation tool status to moderators.

## Third-Party Services

When OpenAI-backed filters are enabled and an OpenAI API key is configured,
Supermodds may send relevant post, comment, media metadata, text, and URLs to
OpenAI's API for automated review. The app uses those responses only to support
moderation decisions configured by subreddit moderators.

Supermodds runs on Reddit's Devvit platform. Reddit may process information
according to its own terms and policies.

## Data Storage And Retention

Supermodds stores operational data in Devvit-provided Redis. Retention depends
on the workflow:

- Deduplication records are generally kept for up to 30 days.
- Activity and rate-limit records are kept only as long as needed for the
  configured workflow windows.
- Subreddit workflow settings remain until changed, disabled, or removed by
  moderators or app administrators.

The app does not provide a separate user account system.

## Data Sharing

Supermodds does not sell personal information. Information is shared only as
needed to operate the app, including with Reddit Devvit infrastructure and, when
enabled, OpenAI's API for configured automated review workflows.

## Moderator Control

Subreddit moderators can enable, disable, and configure supported workflows
through Reddit Devvit settings and Supermodds moderator actions. Removing or
disabling the app may stop future processing for that subreddit, subject to
Reddit and Devvit platform behavior.

## Security

Supermodds relies on Reddit Devvit settings for secret storage and platform
access controls. Moderators should keep API keys private and avoid placing
secrets in public posts, comments, or workflow text.

## Children's Privacy

Supermodds is a moderation tool for Reddit communities and is not directed to
children. The app does not knowingly collect personal information from children.

## Changes To This Policy

This policy may be updated as Supermodds changes. Updates will be reflected in
this file with a revised "Last updated" date.

## Contact

For privacy questions about Supermodds, contact the app maintainer through the
project repository or the Reddit account responsible for the app installation.
