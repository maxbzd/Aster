# Claude and Aster (MCP)

[Русский](ru/MCP.md)

With MCP (Model Context Protocol), an ordinary Claude chat can read and write your Aster data. Connect once, then just talk:

- "Log a meeting with Oliver Stone: we had coffee, he is looking for an investor, we agreed on an intro."
- "Remind me on Friday at 11:00 to write to Oliver about the contract."
- "What do I have today?"

Whatever is recorded appears in the app right away (through the same sync that links your devices), so nothing needs to be entered twice.

## Connect (a minute)

1. Sign in to the cloud in the app (see [CLOUD.md](CLOUD.md)).
2. **Profile, Claude**, then **Create a key**.
3. Copy the address that is shown. It is shown once: the database stores only its fingerprint.
4. Add the address to Claude:
   - **claude.ai or the Claude app:** Settings, Connectors, "Add custom connector", name it "Aster" and paste the address.
   - **Claude Code:** `claude mcp add --transport http aster <address>` (the app offers a ready command).
5. Enable the connector in a chat and write as usual.

The address looks like `https://<project>.supabase.co/functions/v1/mcp/<key>`. The key is a long random password that is part
of the address. Do not show it to anyone. If it ends up in the wrong hands, revoke the key in the same place in the app and create a new one.
Revoking works at once.

Supabase secrets you need: the same as for the other functions, `ALLOWED_EMAILS` (your email). Optional: `MCP_TIMEZONE`, your
IANA time zone for dates without one (for example `Europe/Berlin`; the default is `UTC`).

## What Aster offers Claude

| Tool | What it does |
| --- | --- |
| `get_now` | The date, weekday and time by your clock (so Claude can turn "tomorrow" and "on Friday" into dates) |
| `today_overview` | Overdue and today's reminders, dates for the next 14 days, who is due for a message |
| `search_people` | Search by name (any case form), company, city, interests, what a person looks for or can do |
| `get_person` | The card: work, what they look for, facts, topics, reminders, recent meetings |
| `add_person` | A new person (it will not create a duplicate for the same full name) |
| `update_person` | Extend a card: company, city, circle, facts, topics, notes, contacts |
| `log_interaction` | Record a meeting, call, messages, event, favor, gift or note; updates "last contact" |
| `list_interactions` | Interaction history over a period |
| `add_reminder`, `list_reminders`, `update_reminder`, `complete_reminder` | Reminders |

Claude passes dates as `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` by your clock. If only a day is named, the reminder comes at 9:00.

## What Claude does not do

- It does not delete people, records or reminders (it only closes tasks). Deleting is done in the app.
- It cannot see AI keys or settings.
- If several people match a name, it does not guess: it asks you to be specific.

## How it works and how it is protected

- The Edge Function `mcp` (`supabase/functions/mcp`), the stateless Streamable HTTP protocol: one address, JSON per request.
- The key has 256 bits of randomness. The table `mcp_tokens` stores only the SHA-256; keys can be created, listed and revoked
  only through database functions under your sign-in. No more than five keys at a time.
- Every request checks that the key is not revoked and that the owner's email is in `ALLOWED_EMAILS`; at most 120 requests a minute per key.
- Data is written to the same sync tables (`records` through `mcp_put`), in the same formats the app writes.
- Supabase's function logs show the request address together with the key. The logs are visible only to the project owner.

## Troubleshooting

- Claude says the connector does not respond: check that the key is not revoked and the address was pasted whole.
- "This account is not allowed access": the account's email is not in the project's `ALLOWED_EMAILS`.
- A record did not show up in the app: open the app and wait a few seconds (you need to be signed in to the cloud and online).
