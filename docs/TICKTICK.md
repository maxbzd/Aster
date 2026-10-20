# TickTick link

[Русский](ru/TICKTICK.md)

Reminders from Aster appear in TickTick, and the "done" mark works both ways.

- **New in the app → TickTick:** within a minute the task appears in TickTick's Inbox, with the title, due date, and a note on where it came from and which person it concerns.
- **Done in the app → closed in TickTick.**
- **Done in TickTick → marked in the app** (checked once a minute while the app is open).
- **Tasks from TickTick do not come into the app.** The app only learns that a task it sent has been closed.
- If you delete a task in TickTick, it is no longer polled and not recreated. If you delete it in the app, it stays in TickTick.

It runs while the app is open (a tab or the installed app): sync happens from the app itself, once a minute, when you return to the tab and a couple of seconds after any edit.

## Setup (once)

1. Open <https://developer.ticktick.com>, **Manage Apps**, **New App**. Any name, for example "Aster". In **OAuth redirect URL** enter the address of your project's function:
   `https://<your-project-ref>.supabase.co/functions/v1/ticktick/callback`
2. Copy the app's **Client ID** and **Client Secret**.
3. In Supabase, **Edge Functions, Secrets**, add:
   - `TICKTICK_CLIENT_ID`: the Client ID;
   - `TICKTICK_CLIENT_SECRET`: the Client Secret.

   `ALLOWED_EMAILS` and `ALLOWED_ORIGINS` are shared by all functions of the project (see [DEPLOY.md](DEPLOY.md)); `ticktick` uses the same ones.
4. In the app: **Profile, TickTick**. Press "Connect TickTick", allow access and return.

You must be signed in to the cloud in the app: the link goes through your account.

## How it works

- The Edge Function `ticktick` (`supabase/functions/ticktick`) has no platform-level JWT check (the return route from TickTick needs that), but every other route checks the Supabase session and the `ALLOWED_EMAILS` list itself.
- The TickTick token and the links "app record ↔ TickTick task" live in the tables `ticktick_tokens` and `ticktick_links`. Their permissions are closed to everyone but the function.
- The return from TickTick is protected by a signed `state` (HMAC with the TickTick app secret, valid 10 minutes) and a check of the return address against `ALLOWED_ORIGINS`.
- A key `aster:reminder:<id>` links a record to a task. The link is claimed before the task is created, so two devices at once cannot create a duplicate.
- A TickTick token lives about half a year. When it expires, settings show "Access expired"; just connect again.

## Troubleshooting

- Settings say "TickTick is not set up on the server yet": the secrets in step 3 are missing.
- You returned after consenting but there is no connection: the redirect URL in the TickTick app must match step 1 character for character.
- A task did not appear: press "Sync" in settings and read the red message; the function's logs are in Supabase, Edge Functions, ticktick, Logs.
