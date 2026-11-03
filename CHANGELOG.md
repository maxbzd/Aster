# Changelog

All notable changes to Aster are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Graph of connections works from the keyboard**: every person in it is now a button with a name (initials first, then the full name), instead of a shape that only a mouse could click. The year story's progress is run by the browser instead of a script on every frame, pauses when held or when the tab is hidden, and with "reduce motion" it waits for a tap instead of moving on by itself.
- **A full storage is no longer silent.** When the browser refuses to save a change for lack of room, a notice says so at once ("Storage is full. The last change was not saved. Nothing saved earlier is lost") with two ways out: make a backup, or clear what can be rebuilt (the cache of AI answers). It disappears by itself when writes work again, and an early warning appears from 90 % of the space the browser allows. It also covers the encrypted copy on disk when the device vault is on, and a backup no longer reports failure when only its reminder date could not be saved. Checked in a real browser (`npm run e2e:quota`, in CI).
- **Quality baseline** (`docs/QUALITY.md`): every area measured, with the commands to repeat it. First fixes: the animation engine loads after the first paint (Lighthouse performance 0.64 to about 0.8, blocking time 1360 to under 200 ms), secondary text contrast 3.3:1 to 5.1:1, avatar initials no longer disagree with button names, `robots.txt`, actions pinned by commit hash with Dependabot. `npm run e2e:audit` (now in CI) fails on any request to another origin, any serious accessibility violation on 15 screens, or an app that does not open offline.
- **A browser test of the vault in CI** (`npm run e2e:vault`, `scripts/e2e-vault.mjs`). In a real Chromium it loads example data, reads every IndexedDB store the way anyone with the browser's files could, turns "Protect this device" on and checks that nothing readable is left (locked or unlocked) and the plain database is gone, then checks a wrong password, the right one and the recovery key, and fails on any content-policy or Trusted Types violation or console error. It runs on every pull request.
- **Encrypt cloud data** (Cloud): every record is sealed on your devices with a key that never leaves them, so the server and anyone who gets into it hold only envelopes. Edits still merge field by field, on the devices. A new device gets the key from an old one through a quantum-safe exchange (X25519 + ML-KEM-768, two codes, with 12 check digits to compare so a swapped code is noticed), or from a recovery key written down at the start. A device without the key reads nothing and sends nothing. What stops working with it on: anything that reads records on the server (the Claude connection, the Orbita bridge, TickTick). Turning it on re-sends everything sealed with fresh stamps, so no plain copy stays behind.
- **Replaced edits** (Cloud): when two devices change the same field and the newer edit wins, the older value is kept in a list. You can bring it back with one tap (it is saved as a new edit and syncs like any other), or copy it when it sits inside a list item.

### Added (encryption)

- **Trusted Types.** The content policy now also requires them for scripts: the browser refuses any string that is about to become code (`innerHTML`, `eval`-like calls, a script or worker address). The one exception is a default policy (`public/tt-policy.js`) that lets through only script addresses on the app's own origin, which is what registering the service worker needs. Checked in Chromium across every screen: no violations. zod no longer tries to compile schemas with `new Function` (that was the one thing that tripped it).
- **Protect this device** (Profile): encryption at rest. With it on, nothing readable is ever written to the device: the database lives in memory while the app is open, and only sealed records (AES-256-GCM, each bound to its place) go to an encrypted journal within a fraction of a second and whenever the app is left. The data key is wrapped by your password (Argon2id), by a recovery key shown once, and optionally by passkeys (Face ID, fingerprint, security key, through the WebAuthn PRF extension: the secret never leaves the authenticator). Locking, by hand, after a time of inactivity or after leaving the app, reloads the page, which drops every plain value from memory. One window at a time. Verified in Chromium: before, every name is readable in IndexedDB; after, none, and the plain database is gone. Turning it off brings the plain database back.
- Encrypted backups. **Profile → Backup** now offers an encrypted file (Argon2id → AES-256-GCM, the password is chosen when saving) or a plain one. Restoring recognises an encrypted file and asks for the password.
- Automatic copies into a folder (Chrome, Edge, Android Chrome): an encrypted copy every day without asking for a password. Each is sealed to a public key (X25519 + ML-KEM-768, so it also holds against a future quantum computer); the matching private key exists only as a passphrase you choose, and is needed only to restore. The last 14 copies are kept. The folder and key stay on the device and are not part of backups or sync.
- A shared crypto layer in `src/crypto/` (password sealing, hybrid sealing to a public key) with tests.

### Changed

- The on-device assistant now reads notes in Spanish, German, French, Portuguese and Ukrainian too (who was met, role, city, field), not only English and Russian: `src/ai/local/langs.ts`. On the first set of sentences it went from about 0% to 100% in those languages; on a second set written afterwards and not used for tuning, the first run scored 67% (see [docs/NEURAL.md](docs/NEURAL.md)), which is the number to keep in mind.

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
