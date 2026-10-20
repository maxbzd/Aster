# Security policy

## Supported versions

Security fixes go into the latest release on the `main` branch.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately with GitHub's [private vulnerability reporting](https://github.com/maxbzd/Aster/security/advisories/new)
(the "Report a vulnerability" button on the Security tab). Include what you found, how to reproduce it, and the impact.
You will get an acknowledgement within a few days, and we will keep you informed as it is fixed. Please give us a reasonable time to
release a fix before disclosing details publicly.

## What counts

Aster keeps data on the user's device and has optional server components (Supabase migrations and Edge Functions in `supabase/`,
an example proxy in `api/`). Especially interesting:

- ways to read or write another user's data (row-level security, the `sync_push`, `bridge_*`, `mcp_*` functions);
- ways to use server-side AI keys without being on the allow-list, or to make the Edge Functions call unintended hosts;
- leaks of API keys or tokens into backups, sync, logs or the browser;
- cross-site scripting or content-policy bypasses in the web app.

## For people who host Aster

- Keep `ALLOWED_EMAILS` and `ALLOWED_ORIGINS` set, and switch off public sign-ups in Supabase if the project is only for you.
- Never put a service-role key or an AI key in the app's build variables (`VITE_*` values are public). Use Edge Function secrets.
- Review `public/_headers` for your host and keep the content policy strict.
