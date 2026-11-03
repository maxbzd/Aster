# Changelog

All notable changes to Aster are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (encryption)

- Encrypted backups. **Profile → Backup** now offers an encrypted file (Argon2id → AES-256-GCM, the password is chosen when saving) or a plain one. Restoring recognises an encrypted file and asks for the password.
- Automatic copies into a folder (Chrome, Edge, Android Chrome): an encrypted copy every day without asking for a password. Each is sealed to a public key (X25519 + ML-KEM-768, so it also holds against a future quantum computer); the matching private key exists only as a passphrase you choose, and is needed only to restore. The last 14 copies are kept. The folder and key stay on the device and are not part of backups or sync.
- A shared crypto layer in `src/crypto/` (password sealing, hybrid sealing to a public key) with tests.

### Fixed

- Russian notes: a city after a bare "в" / "из" ("дизайнер в Берлине") is now found, "Вены" and "Рима" match (JavaScript's `\\b` does not see Cyrillic), and "логистической" counts as logistics.

### Added

- Sync no longer loses edits made on two devices offline. Rows are merged field by field against their common ancestor (tags as sets, notes word by word, appended lines kept on both sides); only a same-field clash falls back to "the newer wins", and the older value is kept in a conflict log. A sync cycle is now pull, merge, push, pull. See [docs/CLOUD.md](docs/CLOUD.md).
- Optimistic concurrency in `sync_push`: new migration `20261014000000_sync_push_base_ts.sql` declines a write made on a version the cloud no longer holds. **Apply it to your Supabase project**; without it everything still works, with the old whole-row rule.
- A multilingual extraction benchmark (`tests/ai/extraction.corpus.ts`): 56 notes in the 7 interface languages, scored on person, role, city and field. It measures the rule-based engine at 100% in English and Russian and about 0% elsewhere, which is the starting point for [an on-device neural extractor](docs/NEURAL.md).
- iPhone and iPad in a Safari tab, where the browser deletes a site's data after 7 idle days: the onboarding explains it before anything is typed in and shows how to add Aster to the Home Screen; the home screen reminds until it is installed and asks for backups sooner.
- A content policy in the built `index.html`, copied from `public/_headers`. GitHub Pages cannot send headers, so the hosted app ran with no policy at all.

## [1.0.0] - 2026-10-22

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
