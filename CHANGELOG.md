# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Privacy policy and terms and conditions documents.
- +18 image review filter trigger for routing OpenAI-classified image posts and image replies to the needs review queue.
- Copyright material filter trigger for routing media posts and replies with OpenAI-classified copyright-review signals to the mod queue.
- Devvit settings and HTTP fetch configuration for the copyright material filter's external API.
- Modmail spam closer trigger for archiving bot appeals and spammy user modmail with an internal audit note.
- Moderator Permission Chain form and mod-action trigger for assigning full permissions to a remaining moderator when the configured chain rules match.
- New subreddit bot guard trigger for filtering bursty posts and comments from newly seen, low-trust accounts.
- Post Frequency Limiter form for moderator-managed post count and rolling-window configuration.
- Post frequency limiter trigger for restricting users to a configured number of posts in a rolling time window.
- README documentation for the Redacted Edit Reporter and moderator usage workflow.
- Redacted edit reporter trigger for flagging older post edits that remove meaningful word content.
- Registered moderator tool architecture for Devvit menu actions, forms, and dashboard metadata.
- User Workflow Builder for moderator-configured post, comment, and subcomment keyword workflows.

### Changed

- OpenAI API key configuration now relies on a private global app secret without a shipped default value so Devvit publish validation passes.
