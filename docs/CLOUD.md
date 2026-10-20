# Cloud: how sync works

[Русский](ru/CLOUD.md)

Aster stays **local-first**: the interface always reads from and writes to IndexedDB (Dexie), so everything works offline and
instantly. The cloud (Supabase) is a copy that catches up in the background and links the devices of one account. The cloud is
optional: build the app without `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` and none of this appears.

## Design

```
Dexie (device) ──hook──▶ outbox ──push──▶ sync_push() ──▶ records (Postgres, RLS)
        ▲                                                       │
        └──────── applyRemote ◀── pull (seq > cursor) ◀─────────┘
                                         ▲
                              Realtime ping, focus, network, timer
```

- **Table `records`**: one row per record of the app (`tbl`, `id`, `data jsonb`, `deleted`, `client_ts`, `seq`). You can read
  only your own rows (RLS). Direct writes are not allowed, only through `sync_push`, which sets the owner itself, checks the
  format and strips `settings.ai`, so Astra's keys never reach the cloud.
- **The `outbox` queue** in Dexie: hooks on create, update and delete put the row key there. A delete is a tombstone
  (`deleted = true`) so it reaches the other devices.
- **Conflicts**: the row with the larger `client_ts` (the device's monotonic edit time) wins. The rule is the same on the
  server (`sync_push`) and on the client (`applyRemote`): your own unsynced edit that is newer is not overwritten by the cloud;
  a newer cloud version replaces the local queue. The assumption is that device clocks are roughly right.
- **Cursor** `seq` is an increasing number of each accepted change. The client steps back by `PULL_OVERLAP` so it does not
  miss transactions committed later. Applying is idempotent (content is compared), so reading twice is harmless.
- **Poison records**: if the server permanently rejects a record (too large, bad format), the batch is split in half, the
  culprit is parked (a counter on the Cloud screen), and the rest goes through. Network failures are not handled this way: everything stays queued.
- **Wrong clocks**: the server does not accept an edit time more than a minute ahead of its own, so a device whose clock is in
  the future cannot win every conflict forever.
- **Demo data** never reaches an account: it is removed from the device on first sign-in.
- **Device-only**: `settings.ai` (Astra's keys and mode), `lastBackupAt`, `backupSnoozeUntil`, and the AI cache and spending
  counters. Edits to these fields are not even queued.

## Lifecycle

1. **Sign-in**: email and password (`signInWithPassword`). The session lives in `localStorage` and refreshes itself.
2. **First connection**: if the device already had data, it is queued with "last edit" stamps and merged with the cloud
   (nothing is lost; the fresher version wins).
3. **A different account on the same device**: the previous account's local data is removed (without being sent) so people do not get mixed.
4. **Sign-out**: the queue is flushed first; if it cannot be (no network) you must confirm. Then the data is removed from the
   device; it stays in the cloud.
5. **Sync runs**: about 1.2 s after an edit, on a Realtime signal, when you return to the app, when the network comes back,
   and once a minute. Never more than one at a time; on errors it retries with a growing delay (3 s up to 5 min).

## Files

| File | Role |
| --- | --- |
| `src/cloud/engine.ts` | queue, push, pull, merge (knows nothing about the network) |
| `src/cloud/controller.ts` | start/stop, timers, retries, account switching |
| `src/cloud/cloud.ts` | sign-in, sign-out, links from emails, account deletion |
| `src/cloud/remote.ts` | requests to Supabase |
| `src/cloud/boot.ts` | a light entry point: enables the hooks and lazy-loads the rest |
| `src/sheets/CloudSheet.tsx` | the Cloud screen |
| `supabase/migrations/` | schema, policies and functions |

## Your own Supabase project

1. Create a project and run `supabase/migrations/*.sql`, in order.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (the publishable key) at build time; see `.env.example`.
3. In Authentication, URL Configuration, set **Site URL** to the address where the app is published (links in emails lead
   there). Optionally turn on leaked-password protection and connect your own SMTP: the built-in email sender is limited to a few emails per hour.

See [DEPLOY.md](DEPLOY.md) for the whole setup.

## Tests

- `npm test` runs the engine and the controller against in-memory "servers" with the same rules as the SQL; random operations on
  three devices must converge.
- A live run against a real Supabase project (two devices, Realtime, user isolation, no access without sign-in, 300 records):
  ```bash
  ASTER_E2E_URL=https://<ref>.supabase.co ASTER_E2E_KEY=sb_publishable_... \
  ASTER_E2E_USER1=email:password ASTER_E2E_USER2=email:password npx vitest run tests/e2e/cloud
  ```
  It needs two test users; without the variables the tests are skipped.
