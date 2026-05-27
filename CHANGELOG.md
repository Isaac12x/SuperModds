# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- +18 image review filter trigger for routing OpenAI-classified image posts and image replies to the needs review queue.
- Copyright material filter trigger for routing media posts and replies with OpenAI-classified copyright-review signals to the mod queue.
- Devvit settings and HTTP fetch configuration for the copyright material filter's external API.
- New subreddit bot guard trigger for filtering bursty posts and comments from newly seen, low-trust accounts.
- README documentation for the Redacted Edit Reporter and moderator usage workflow.
- Redacted edit reporter trigger for flagging older post edits that remove meaningful word content.
- Registered moderator tool architecture for Devvit menu actions, forms, and dashboard metadata.
