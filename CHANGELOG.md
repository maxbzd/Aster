# Changelog

All notable changes to Aster are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-20

First open-source release.

### Added

- Full English and Russian localization, including the on-device assistant (it understands both languages), voice commands, demo data and dates. A small dependency-free translation layer, language picker, `npm run i18n:check`, and [a guide to adding languages](docs/I18N.md).
- A generic OpenAI-compatible gateway provider for the server-side AI function (`GATEWAY_API_KEY`, `GATEWAY_BASE_URL`, `GATEWAY_MODELS`) next to Claude, Gemini and Groq.
- English documentation, contribution guide, code of conduct, security policy, issue and pull request templates.

### Changed

- The cloud, server-side AI, MCP, TickTick and the Orbita bridge are fully optional: with no Supabase project configured, the app is entirely local and hides the online features.
- Supabase project settings come from `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` at build time; nothing project-specific is committed.
- The model comparison suite runs in English with neutral made-up data.

### Removed

- All personal data, project identifiers and hosting references of the original author.
