# Deploying to Cloud Run

The dev setup keeps your API key in `.env` and lets Vite's proxy attach it.
That proxy only exists during `npm run dev`. In production, `server/index.mjs`
does the same job: it serves the built frontend and forwards
`POST /api/screen-graphql` to SCREEN with the key attached server-side.

The frontend code is unchanged — it still posts to the same path.

## One-time setup

```sh
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

## Store the key

Put it in Secret Manager rather than passing it as a plain env var, so it
isn't visible in your deploy history or in the Cloud Console UI.

```sh
printf 'api_sk_YOUR_KEY' | gcloud secrets create screen-api-key --data-file=-
```

Let the Cloud Run service account read it:

```sh
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" \
  --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding screen-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

## Deploy

```sh
gcloud run deploy rnaseq-browser \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets SCREEN_API_KEY=screen-api-key:latest \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3
```

`--source .` builds the Dockerfile with Cloud Build and pushes it for you; no
local Docker needed. First deploy takes a few minutes, later ones are faster.

It prints a `https://rnaseq-browser-....run.app` URL. That's your link.

`--min-instances 0` means it scales to zero and costs nothing when idle, at the
price of a few seconds' cold start on the first request after a quiet period.
`--max-instances 3` is a spend cap — raise it if you ever have real traffic.

## Redeploying

Same command. To roll back, use the Revisions tab in the Cloud Console.

## Rotating the key

Keys expire 90 days after creation. To swap one in without redeploying:

```sh
printf 'api_sk_NEW_KEY' | gcloud secrets versions add screen-api-key --data-file=-
gcloud run services update rnaseq-browser --region us-central1 \
  --set-secrets SCREEN_API_KEY=screen-api-key:latest
```

## Things to check after the first deploy

**bigWig CORS.** Your tracks load directly from `users.wenglab.org` in the
visitor's browser, not through this server. That host currently allows
`localhost:5173`; whether it allows your `run.app` origin is a separate
question. If tracks are empty in production but fine locally, open the console
and look for a CORS error, then ask Jair to allow the origin. Failing that,
proxy the bigWigs through this server too — but that puts all track traffic
through Cloud Run, which is slower and costs more.

**The proxy is an open relay.** Anyone with the URL can query SCREEN using your
key. `server/index.mjs` rate-limits to 120 requests/minute/IP, which stops
crawlers and runaway loops but is not real access control — it's in-memory, so
it resets on restart and is per-instance rather than global.

If you later need to actually restrict access, the options in increasing order
of effort: drop `--allow-unauthenticated` and use IAM (good for lab-internal,
requires Google sign-in); put Identity-Aware Proxy in front; or add a shared
password to the server. None of these are worth doing for a link shared with
colleagues, all of them become worth doing if the URL spreads.

## Local production check

Before deploying, confirm the built app works the way it will in production:

```sh
npm run build
SCREEN_API_KEY=api_sk_YOUR_KEY npm start
```

Open http://localhost:8080. This runs the exact code path Cloud Run will,
which catches problems the dev server hides.
