# HireMinds AI

HireMinds is a React/Vite hiring platform backed by Supabase Auth, PostgreSQL, Storage, and Edge Functions. Production interview streaming and Bhashini speech requests run through a Node.js API on Render.

## Production architecture

```text
Browser → Vercel (Vite SPA) → Render API
                              ├─ Supabase Auth/Postgres/Storage
                              ├─ Groq
                              └─ Bhashini
```

The browser uses only the Supabase publishable key. Database credentials, Supabase secret keys, Groq keys, and Bhashini credentials are server-only.

## Local development

Requirements: Node.js 20.11 or later (Node.js 22 recommended) and npm.

1. Copy `.env.example` to `.env` and replace placeholders locally. `.env` is gitignored.
2. Install dependencies:

   ```bash
   npm ci
   npm --prefix server ci
   ```

3. Start the Render-compatible backend:

   ```bash
   npm run backend:dev
   ```

4. In another terminal, start the frontend:

   ```bash
   npm run dev
   ```

The local frontend uses `http://localhost:10000` when `VITE_API_BASE_URL` is omitted.

## Verification commands

```bash
npm run lint
npm run test
npm run build
npm run backend:test
```

## Database migrations

Migrations live in `supabase/migrations`. Review and back up production data before applying schema changes, then use the current Supabase CLI:

```bash
npx supabase --help
npx supabase db push
```

Do not run destructive migrations automatically from an HTTP request or from the Render start command.

## Render deployment

The repository includes `render.yaml`. Create a Render Blueprint from this repository; it builds from `server/`, runs `npm start`, binds to `0.0.0.0:$PORT`, and uses `/health` for liveness. `/ready` verifies PostgreSQL and required providers.

Set these values in the Render Dashboard when the Blueprint prompts for them:

| Variable | Value source |
|---|---|
| `DATABASE_URL` | Supabase Dashboard → Connect → Session Pooler; append `sslmode=require` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Supabase backend secret key (`sb_secret_...`) |
| `GROQ_API_KEY_1` | Primary Groq API key |
| `GROQ_API_KEY_2` | Secondary Groq API key |
| `GROQ_API_KEY_3` | Tertiary Groq API key |
| `BHASHINI_UDYAT_KEY` | Bhashini Udyat/user credential |
| `BHASHINI_INFERENCE_KEY` | Bhashini inference/ULCA credential |
| `FRONTEND_URL` | Exact production Vercel origin, without a trailing slash |
| `CORS_ORIGINS` | Comma-separated exact allowed origins, without paths |

`APP_ENV`, `DB_POOL_MAX`, `GROQ_MODEL`, `BHASHINI_PIPELINE_ID`, and `NODE_VERSION` are safe defaults in `render.yaml`. Render injects `PORT`; do not create it manually.

After deployment, verify:

```text
GET https://YOUR-RENDER-SERVICE.onrender.com/health
GET https://YOUR-RENDER-SERVICE.onrender.com/ready
```

## Vercel deployment

Import the repository as a Vite project. `vercel.json` uses `npm ci`, `npm run build`, the `dist` output directory, and an SPA refresh fallback.

Set only these three variables for Production (and Preview only when the preview origin is also allowlisted on Render):

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://YOUR-RENDER-SERVICE.onrender.com` |
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT-REF.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |

Never add `DATABASE_URL`, `SUPABASE_SECRET_KEY`, Groq keys, or Bhashini credentials to Vercel or to any `VITE_*` variable.

## Supabase production settings

- Add the exact Vercel production URL to Auth **Site URL** and **Redirect URLs**.
- Add only intentional preview/custom domains to Redirect URLs.
- Keep resume, identity document, and recording buckets private with RLS-backed access.
- Deploy versioned migrations before testing production workflows.
- Non-interview Edge Functions may still require provider secrets such as `RESEND_API_KEY`; set them in Supabase Edge Function Secrets, never in Vercel.

## Security notes

- The Render API validates the Supabase user access token and verifies application ownership before starting an interview request.
- CORS is an exact origin allowlist; wildcard credentialed CORS is not enabled.
- Logs include request IDs but do not include credential values.
- Render local disk is not used for persistent files.
