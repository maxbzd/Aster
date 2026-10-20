# Bridge between apps: Aster and Orbita

[Русский](ru/BRIDGE.md)

Aster and its companion app **Orbita** (tasks, commitments, decisions and a daily journal; an open-source project, [github.com/maxbzd/Orbita](https://github.com/maxbzd/Orbita)) are two separate apps with **separate databases** (separate Supabase projects). They exchange data through a
"like a calendar" connection: show a code in one app, paste it in the other, and the data flows. The second account's password is not needed.

The shared code (`src/bridge/protocol|pairing|peer|own|connect|match|cycle.ts`) is **identical** in both apps: change it in one and update the copy in the other.
If you only use Aster, you can ignore the bridge: it stays hidden unless the cloud is configured and does nothing until you pair.

## What is exchanged

| Kind of data | Direction | Result |
| --- | --- | --- |
| `person`, `person_stats` | both ways | the list of people and a summary (Aster: last contact, closeness; Orbita: mentions, open commitments) |
| people links | both ways | "person in Aster = person in Orbita"; an identical full name links on its own, the rest by confirmation |
| `commitment` | Orbita → Aster | a commitment becomes a reminder (on the linked person) |
| `commitment_state` | Aster → Orbita | "done/open" of the reminder returns to the commitment; the later edit wins |
| `capture` | Orbita → Aster | a record of a meeting is a **suggestion** to add to the person's timeline (a summary and a day, no full text) |
| `fact` | Orbita → Aster | a fact about a person, as a suggestion to add to the card |

Not exchanged: AI keys and settings, mood and state, the full text of records, demo data. The owner can switch each kind off in the bridge settings.

## How it works

```
Aster                                                        Orbita
 local data ─collect→ bridge_feed (Aster project)    ←pull(token)─  Orbita reads
 Aster reads ─pull(token)→ bridge_feed (Orbita project) ←collect─ local data
```

1. **A feed.** Each app publishes a table `bridge_feed` in its own project (neutral records: `entity`, `key`, `data`, `updated_ms`). Only the signed-in owner writes to it, through `bridge_publish`.
2. **Pairing by code.** App A: `bridge_create_offer` produces a one-time code valid for 10 minutes. App B creates its own key (`bridge_register`, only a hash is stored), exchanges the code for A's key (`bridge_accept`) and records it (`bridge_complete`). The code is `bridge1.<base64url{url, key, code, label}>`.
3. **Reading.** The other side reads the feed anonymously with `bridge_pull(token, after, limit)`: the server checks the key's hash and returns only the kinds of data the owner allowed (`scopes`). The key is 256 bits of randomness, tied to one account and revocable: `bridge_disconnect` on your side or `bridge_drop` from the other.
4. **The cycle** (`cycle.ts`): publish what changed (by fingerprints), pull the other side's changes with a cursor (with a step back), apply through an adapter (idempotent, no duplicates: mirrors have deterministic ids like `bridge-<key>`). It runs on sign-in, once a minute, when you return to the app and after edits.
5. **People links** are stored on the server in `bridge_links` (shared by devices). The app that linked two people says so through `peerRef` in the `person` record; `peerRef: null` is an explicit unlink (auto-linking will not bring that pair back).
6. **Adapters** (`asterAdapter.ts`, `orbitaAdapter.ts`) know their app's model; everything else is shared.

## Conflicts

- A commitment: title, due date and person belong to Orbita; "done" can be marked in either app, the later edit (`updated_ms`) wins.
- If you delete a mirrored reminder in Aster, it does not come back (`settings.bridgeHandled`).
- Deleted at the source: the mirror is deleted.

## Security

- Only three functions are anonymous: `bridge_accept`, `bridge_pull`, `bridge_drop`; each checks the key or code inside. All the others require sign-in.
- The tables are closed to direct reads and writes (RLS and no grants): everything goes through functions.
- In Orbita, `index.html` must allow connections to the Aster Supabase address (`connect-src`). In Aster, `public/_headers` allows `*.supabase.co`.
- You must be signed in to the cloud in **both** apps: connections and links live in your accounts.

## Connecting (for a person)

1. Sign in to the cloud in both Aster and Orbita (they are different Supabase projects; you can use the same email and password).
2. In Aster: Profile, "Orbita app", "Show code".
3. In Orbita: Settings, "Apps", "Enter code", paste it.
4. Check "People": confirm the ambiguous matches.

## Server setup

Apply `supabase/migrations/…_bridge.sql` in **both** Supabase projects (SQL editor or `supabase db push`). The file is the same.

## Tests

- `npm test` covers the core (code, pairing, cycle, conflicts) and the adapters on in-memory "projects" with the same rules as the SQL.
- The SQL was checked in a rolled-back transaction: one-time code, key hash, permission filter, revocation, user isolation, no direct access.
- A live run on two real projects: see the header of `tests/e2e/bridge.live.test.ts`.
