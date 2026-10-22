# Changelog

All notable changes to Aster are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-20

First open-source release.

### Added

- Seven interface languages: English, Spanish, German, French, Portuguese (Brazil), Ukrainian and Russian. The on-device assistant, voice commands, demo data and dates are fully localized in English and Russian; other languages fall back to English there, and a cloud model answers in the interface language. Spanish, German, French, Portuguese and Ukrainian are AI-drafted and open for native review. A small dependency-free translation layer, language picker, `npm run i18n:check`, and [a guide to adding languages](docs/I18N.md).
- The CSV/Excel importer recognizes column headers in all supported languages.
- Link previews: Open Graph and Twitter card metadata with a preview image.
- Hosting: a GitHub Pages workflow (`.github/workflows/deploy.yml`) and a tag-triggered release workflow that attaches the static build.
- A generic OpenAI-compatible gateway provider for the server-side AI function (`GATEWAY_API_KEY`, `GATEWAY_BASE_URL`, `GATEWAY_MODELS`) next to Claude, Gemini and Groq.
- English documentation, contribution guide, code of conduct, security policy, issue and pull request templates.

### Changed

- The cloud, server-side AI, MCP, TickTick and the Orbita bridge are fully optional: with no Supabase project configured, the app is entirely local and hides the online features.
- Supabase project settings come from `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` at build time; nothing project-specific is committed.
- The model comparison suite runs in English with neutral made-up data.

### Removed

- All personal data, project identifiers and hosting references of the original author.
