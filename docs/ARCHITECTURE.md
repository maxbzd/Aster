# Architecture

A short tour of how Aster is built, for people who want to read or change the code.

## Principles

1. **Local-first.** The UI reads and writes IndexedDB through Dexie (`src/data/db.ts`) and live queries (`src/data/hooks.ts`).
   Anything online (cloud sync, AI, MCP, TickTick, the bridge) is a background copy or an optional helper. The app is fully usable with no network and no configuration.
2. **Private by default.** Nothing is sent unless the person set it up. Secrets (`settings.ai`) never enter backups or sync.
3. **Small and fast.** The startup bundle has a budget (`npm run size`). Rare screens and sheets, spreadsheet parsing, the Anthropic SDK and the dictionaries are lazy-loaded.
4. **Pure logic first.** Rules live in small pure functions with tests (`src/data/*`, `src/lib/*`, `src/ai/local/*`). Screens are thin.

## Layers

```
screens/ sheets/ components/        React UI (Tailwind 4, Motion)
        │
app/                                routing (HashRouter), global UI state (Zustand), quick actions
        │
data/                               model (types.ts), Dexie schema + migrations (db.ts), actions, warmth logic, search, import/export
lib/                                dates, names and transliteration, colors, .ics, vCard, tables (CSV/XLSX), speech
i18n/                               the translation layer
ai/                                 Astra: local engine (ai/local), prompts, schemas, cloud client, model catalogue
voice/ stt/                         voice commands, speech-to-text, transcripts
cloud/ bridge/ ticktick/ mcp/       optional online features
```

### Data model (`src/data/types.ts`)

People, circles, interactions (the timeline), reminders, reserve leads, lists (collections), introductions, events, captures,
chat messages, settings. Records have string ids and `updatedAt`. Deleting is soft where sync needs it (tombstones in the cloud layer).

**Warmth.** Each person has a rhythm (`cadenceDays`, defaulting from the closeness orbit). Warmth is the ratio of days since the last
contact to the rhythm: hot, warm, cooling, cold. The network pulse is the weighted average (the inner circle weighs more): `src/data/logic.ts`.

### Astra (`src/ai/`)

Two brains behind one interface:

- **Local engine** (`ai/local/`): rule-based parsing of notes, questions, dates, relations and commitments; ranking for "ask your
  network" and the matchmaker; templates for drafts and briefs. It understands English and Russian input at once and writes in the interface language.
- **Cloud model** (`ai/astra.ts`, `ai/client.ts`): structured calls with zod schemas (`ai/schemas.ts`) and per-language system prompts
  (`ai/prompts.*.ts`). Connection modes: server (Supabase Edge Function), own Anthropic key, proxy. Results are cached (`aiCache`) and
  validated; on failure Astra falls back to the local engine.

Astra only produces **plans and drafts**. Anything that changes data goes through a confirmation (`PlanReview`, voice confirmation).

### i18n (`src/i18n/`)

English text is the key; other languages are JSON dictionaries loaded lazily. See [I18N.md](I18N.md).
`LocaleRoot` remounts the tree when the language changes, so every screen re-renders in the new language.

### Optional online features

| Feature | Client | Server |
|---|---|---|
| Cloud sync | `src/cloud/` (outbox, push/pull, merge) | `supabase/migrations/*` (table `records`, `sync_push`, RLS) |
| Server-side AI keys | `src/ai/managed.ts` | `supabase/functions/ai` |
| MCP server for Claude | `src/mcp/keys.ts`, the Claude sheet | `supabase/functions/mcp` |
| TickTick | `src/ticktick/` | `supabase/functions/ticktick` |
| Bridge to Orbita | `src/bridge/` | `supabase/migrations/*_bridge.sql` |

The Edge Functions are written as Deno-independent modules (`handler.ts` takes the environment and its dependencies as arguments),
so ordinary Vitest tests exercise them. Each folder's `index.ts` is only the Deno entry point.

`cloudEnabled()` (`src/cloud/config.ts`) is true only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` are set; when false, the UI hides every online feature.

## Testing

- `tests/data`, `tests/lib`: pure logic and the data layer on fake-indexeddb.
- `tests/ai`: the local engine, in Russian (default locale of the suite) and English (`*.en.test.ts`).
- `tests/cloud`, `tests/bridge`, `tests/api`: sync and bridge against in-memory servers that follow the SQL's rules; Edge Function handlers.
- `tests/ui`: integration tests of every screen and sheet with Testing Library (`tests/ui/harness.tsx`).
- `tests/e2e`: live checks against real Supabase projects; skipped unless you provide credentials.
- `tests/eval`: a model-comparison suite for Astra's tasks; skipped unless you provide an API key.

Time zone and "now" are fixed (see `vitest.config.ts` and `tests/helpers.ts`).
