# Contributing to Aster

Thank you for wanting to help. Aster is a small, opinionated app: local-first, private by default, fast on a phone,
and pleasant to use. Contributions that keep to that spirit are very welcome: bug reports, fixes, features, translations, docs.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Getting started

Requirements: Node.js 22.23.4 or newer (earlier 22.x releases have known security fixes; any 24.22.1+ or 26.12.1+ works too).

```bash
git clone https://github.com/maxbzd/Aster.git
cd Aster
npm install
npm run dev            # http://127.0.0.1:5191
```

Use the demo network (onboarding, "See an example") to look around. Nothing needs to be configured: the cloud, server-side
AI keys, MCP, TickTick and the Orbita bridge are optional and appear only when you set up your own Supabase project (see [docs/DEPLOY.md](docs/DEPLOY.md)).

## Before you open a pull request

```bash
npm run check          # typecheck + lint + i18n check + tests + build + size budget
```

All of it must pass; CI runs the same. Tips:

- `npm run test:watch` for a fast loop, `npx vitest run tests/ai` for a folder.
- Tests run with a fixed time zone and a fixed "now", so write date-dependent tests against `NOW` from `tests/helpers.ts`.
- The suite runs in the **Russian** locale (the app's original language). Tests for English behavior call `setLocale('en')` and restore `'ru'` in `afterAll`
  (see `tests/ai/text.en.test.ts`). New behavior of the on-device engine should be tested in both languages.
- `npm run size` guards the startup download. Put heavy code in a lazy chunk (dynamic `import()`) rather than raising the budget.
- Lint is Biome (`npm run lint`, `npm run lint:fix`).

## Translations (i18n)

Every user-visible string goes through `t()`. **The English text is the key**, other languages live in JSON dictionaries.

- Write `t('Sign in')`, `t('Hello, {name}', { name })`, `tn(n, '{n} day', '{n} days')`. Keys must be string literals.
- Add the Russian text to `src/i18n/locales/ru.json`, then run `npm run i18n:check`. It fails if a message is missing or its placeholders do not match.
- Do not build sentences from fragments: translators need the whole sentence with placeholders.
- A new language is a JSON file plus a few lines: see [docs/I18N.md](docs/I18N.md).

## Code guidelines

- TypeScript, strict. Prefer small pure functions in `src/data/` and `src/lib/` with unit tests; keep screens thin.
- Local-first is a hard rule: the UI reads and writes IndexedDB; the network is only ever a background copy.
- Privacy is a hard rule: nothing is sent anywhere unless the person set it up, and secrets never enter backups or sync.
- Match the surrounding style (naming, comment density, idiom). Comments explain *why*, in English.
- No new runtime dependency without a good reason: the bundle is budgeted.
- The shared code between Aster and Orbita (`src/bridge/`, the Edge Function cores) is kept identical in both projects. Mention it in your PR if you touch it.

## Commits and pull requests

- Keep a pull request focused on one change. Describe what changed and why; include screenshots for UI changes (both themes if relevant).
- Use clear commit messages in the imperative: "Fix birthday reminder across the year boundary".
- Add or update tests with the change, and docs if behavior changes.

## Reporting bugs and proposing features

Use the issue templates. For a bug, include the steps, what you expected, what happened, your browser/device and whether you used the demo data.
For a feature, describe the problem first; a short note on how it fits "local-first, private, fast" helps a lot.
