# Deploying Aster

[Русский](ru/DEPLOY.md)

Aster is a static web app. You can host the `dist/` folder anywhere that serves static files over HTTPS. Server-side
features (AI keys, sync, MCP, TickTick) are optional and run as Supabase Edge Functions.

## 1. Host the app

```bash
npm install
npm run build        # outputs dist/
```

### Cloudflare Workers (the repository is set up for this)

`wrangler.jsonc` serves `dist/` as static assets with single-page-app fallback. Pick your own worker name there, then:

```bash
npx wrangler login
npx wrangler deploy
```

To redeploy on every push, connect your fork in the Cloudflare dashboard: Workers & Pages, your worker, Settings, Builds.
Set the repository and branch, the build command to `npm run build` and the deploy command to `npx wrangler deploy`.
The worker name in the dashboard must match `name` in `wrangler.jsonc`.

### GitHub Pages (automatic)

1. Fork the repository.
2. Settings, Pages, Build and deployment, Source: **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` and publishes the site at `https://<you>.github.io/<repository>/`.

The build uses relative paths (`base: './'`), so the same `dist/` works from a sub-path and from the root of a domain.
Server-side features (AI keys, sync, MCP) need the Supabase Edge Functions from section 2 and are not part of the Pages site.
Add your Pages address to **Redirect URLs** in Supabase (Authentication, URL Configuration) if you use cloud sign-in.

### Any other static host

Cloudflare Pages, Vercel, Netlify and plain nginx all work: build, then upload `dist/`. Make sure that
unknown paths fall back to `index.html` (the app uses `/#/...` addresses, so most hosts need nothing extra).

### Security headers

`public/_headers` sets a strict content policy (own scripts only, connections only to your site, Supabase, Anthropic,
OpenAI and Groq), forbids framing, enables HSTS and denies geolocation. Cloudflare and Netlify read this file as is.
On other hosts, copy the headers into the host's configuration. If you use another AI gateway in **Own key** mode, or another
speech-recognition server, add its address to `connect-src`.

## 2. Optional: your own Supabase project

You need a Supabase project for cloud sync, server-side AI keys, MCP and TickTick. The free tier is enough.

1. Create a project and apply the migrations from `supabase/migrations/` (SQL editor or `supabase db push`).
2. Build the app with your project's address and publishable key (see `.env.example`):
   ```bash
   VITE_SUPABASE_URL=https://<your-ref>.supabase.co
   VITE_SUPABASE_KEY=sb_publishable_...
   ```
   With these two variables set, the app shows the **Cloud** section. Without them, it hides every online feature.
3. In **Authentication, URL Configuration** set **Site URL** to your app's address and add it to Redirect URLs.
4. In **Authentication, Providers, Email** keep email confirmation on. If the project is only for you, switch off
   **Allow new users to sign up** after creating your own account, otherwise anyone can register in your project.
5. In **Authentication, Password security** enable leaked-password protection.

Details of the sync design are in [CLOUD.md](CLOUD.md).

## 3. Optional: server-side AI keys

Deploy the Edge Function `ai` (`supabase/functions/ai`) and set its secrets under **Edge Functions, Secrets**:

| Secret | Purpose | Required |
|---|---|---|
| `ALLOWED_EMAILS` | Owner emails, comma-separated. Only they can use the keys. | **Yes**: an empty list closes access for everyone |
| `ALLOWED_ORIGINS` | Your app's address, for example `https://aster.example.com` (several: comma-separated) | **Yes**: without it the browser is refused |
| `GATEWAY_API_KEY`, `GATEWAY_BASE_URL`, `GATEWAY_MODELS` | Any OpenAI-compatible gateway (OpenRouter, LiteLLM, Ollama, your own). `GATEWAY_BASE_URL` includes the version prefix, for example `https://openrouter.ai/api/v1`. `GATEWAY_MODELS` is a comma-separated list of model ids to offer in the app. | One provider is enough |
| `GEMINI_API_KEY` | Google Gemini (has a free tier) | One provider is enough |
| `GROQ_API_KEY` | Groq (has a free tier) | One provider is enough |
| `ANTHROPIC_API_KEY` | Claude directly | One provider is enough |
| `DEEPGRAM_API_KEY` | Speech recognition with speaker labels and hints for names from your network (takes priority over `STT_API_KEY`) | No |
| `DEEPGRAM_BASE_URL` | Deepgram address, for example the EU endpoint `https://api.eu.deepgram.com` | No |
| `STT_API_KEY` | Fallback speech recognition: an OpenAI or Groq key | No |
| `STT_BASE_URL` | Address of the recognition server if it is not OpenAI (for example `https://api.groq.com/openai/v1`) | No |

Then sign in to the app, open **Profile, Astra**, choose **Server** mode and pick a model. Speech recognition:
Astra, "Transcribing recordings", "Key on the server". Secrets change without redeploying the app or restarting anything.

How the function is protected:

- Keys go only to the provider you configured, from the function. The browser sees just the answer.
- A request must carry a signed-in session. The platform checks the signature; the function checks that the email is confirmed
  and listed in `ALLOWED_EMAILS`. Anyone else, even a registered user, gets 403.
- Requests from other sites are rejected (`ALLOWED_ORIGINS`).
- Only models that match the allow-lists are served, answers are capped at 20,000 tokens, and code execution, files and
  batch processing are closed.
- Limits: 40 requests a minute per account (recognition: 20), 2 MB per request (audio: 25 MB).
- If a key leaks, replace the secret in Supabase and revoke the old key at the provider. The app needs no change.

Free tiers of some providers may use your data for training, and terms differ by region. If you do not want to share more than
needed, turn off **Share notes and history** in Astra's settings. Phone numbers and emails are never sent.

The function's source is `supabase/functions/ai/handler.ts`; its tests are `tests/api/ai-function.test.ts`.

## 4. Optional: more

- MCP server for Claude: [MCP.md](MCP.md)
- TickTick: [TICKTICK.md](TICKTICK.md)
- Bridge to Orbita: [BRIDGE.md](BRIDGE.md)
- A serverless proxy for Claude on Vercel is in `api/claude/` for those who prefer it to Supabase (the "Proxy" mode).

## Troubleshooting

- Build logs: Cloudflare, Workers & Pages, your worker, Deployments.
- Function tests: `npm test`.
- Manual publish: `npm run build`, then `npx wrangler deploy`.

## Comparing models

In the app: Astra, **Server** mode, "Compare models on test tasks" (the `/eval` screen). It runs 14 made-up tasks
(note parsing, chat over records, network search, drafts, a brief) through the models you pick and shows where each one went wrong;
the report downloads as a file. Real data is not used. The same from a terminal with a key in `.env.eval`:

```bash
EVAL_API_KEY=... EVAL_BASE_URL=https://api.openai.com/v1 EVAL_MODELS=gpt-4o,gpt-4o-mini
npm run eval
```
