# Business Accounts App (Next.js)

Standalone internal app for viewing and editing business accounts/contacts with live Acumatica sync.

## Features

- Cookie-based sign-in flow via backend auth endpoints
- Protected `/accounts` page with:
  - Company Name
  - Address
  - Primary Contact
  - Primary Contact Phone
  - Primary Contact Email
  - Category (A/B/C/D)
  - Last Modified
- Search, sort, category filter, and pagination
- Row details drawer with editable fields and notes
- Manual RocketReach enhancement for missing contact name, job title, email, and phone in `/accounts`
- Manual OpenAI web-research suggestion for missing Company Region, Category, Industry Type, and Sub-Category in `/accounts`
- Save writes directly to Acumatica and then refreshes from Acumatica
- Conflict protection using `expectedLastModified` (`409` on stale update)
- Optional Canada Post AddressComplete validation for Canadian address edits

## Environment setup

Create `env.local` (or `.env.local`) with:

```bash
AUTH_PROVIDER=acumatica
AUTH_LOGIN_URL=
AUTH_ME_URL=
AUTH_LOGOUT_URL=
AUTH_FORGOT_PASSWORD_URL=
AUTH_COOKIE_NAME=.ASPXAUTH
AUTH_COOKIE_DOMAIN=
AUTH_COOKIE_SECURE=false

ACUMATICA_BASE_URL=https://meadowbrook.acumatica.com
ACUMATICA_ENTITY_PATH=/entity/lightspeed/24.200.001
ACUMATICA_COMPANY=MeadowBrook Live
ACUMATICA_BRANCH=
ACUMATICA_LOCALE=en-US
ROCKETREACH_API_KEY=

ADDRESS_COMPLETE_API_KEY=AA11-AA11-AA11-AA11
ADDRESS_COMPLETE_FIND_URL=https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Find/v2.10/json3.ws
ADDRESS_COMPLETE_RETRIEVE_URL=https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Retrieve/v2.10/json3.ws
DATA_QUALITY_HISTORY_PATH=./data/data-quality-history.json
```

A template is included in `env.example`.

For this environment:

- `ACUMATICA_COMPANY` should be `MeadowBrook Live`
- the app prefers `/entity/lightspeed/24.200.001`
- if that custom endpoint is unavailable, the app will fall back to `/entity/eCommerce/24.200.001`
- if `eCommerce` is unavailable or unusable for `BusinessAccount` reads, the app will fall back to `/entity/Default/24.200.001`

If you want to mirror Jeff's custom auth gateway instead of direct Acumatica login, set:
- `AUTH_PROVIDER=custom`
- `AUTH_LOGIN_URL`, `AUTH_ME_URL` (required)
- `AUTH_LOGOUT_URL` (optional)

The Sign in page includes a **Forgot your password?** link:
- Defaults to `https://<ACUMATICA_BASE_URL>/Frames/Login.aspx`
- Override with `AUTH_FORGOT_PASSWORD_URL` if you have a dedicated reset URL

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## API routes

- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/business-accounts?q=&category=&sortBy=&sortDir=&page=&pageSize=`
- `PUT /api/business-accounts/:id`

## Tests

```bash
npm test
```

## Deployment

For the current architecture, the simplest production setup is a single Dockerized service with a persistent disk.

- Best fit: Railway with a mounted volume at `/app/data`
- Also works: Render or Fly.io with the same volume pattern
- Poor fit right now: Vercel, because this app writes server state to local files (`SQLite` plus data-quality history)

### Team Use

The app can be shared with a team and support concurrent use, but with one important constraint:

- Run a single application instance with one attached persistent volume
- Do not scale to multiple replicas while the app uses local SQLite and local history files
- Each user can sign in separately and use the existing API routes
- Concurrent edits to the same record are guarded by stale-write protection; conflicting updates return `409` and require a reload

For an internal team of roughly 20 users, the current architecture is a single-instance deployment problem, not a multi-replica deployment problem.

Recommended production environment values:

```bash
READ_MODEL_SQLITE_PATH=/app/data/read-model.sqlite
DATA_QUALITY_HISTORY_PATH=/app/data/data-quality-history.json
AUTH_COOKIE_SECURE=true
```

### Scheduled Call Import And Coaching

Production now expects the daily call import and next-day coaching jobs to be triggered by external schedulers, not by the web process.

Required web-service env vars:

```bash
APP_BASE_URL=https://sales-meadowb.onrender.com
CALL_ACTIVITY_SYNC_ENABLED=true
CALL_ACTIVITY_SYNC_EXTERNAL_SCHEDULER_ENABLED=true
CALL_ACTIVITY_SYNC_SECRET=...
CALL_ACTIVITY_SYNC_SCHEDULE_HOUR=17
CALL_ACTIVITY_SYNC_SCHEDULE_MINUTE=0
CALL_ACTIVITY_SYNC_TIME_ZONE=America/Toronto
CALL_ACTIVITY_SYNC_MAX_BATCHES_PER_WINDOW=200

DAILY_CALL_COACHING_ENABLED=true
DAILY_CALL_COACHING_EXTERNAL_SCHEDULER_ENABLED=true
DAILY_CALL_COACHING_SECRET=...
DAILY_CALL_COACHING_SCHEDULE_HOUR=7
DAILY_CALL_COACHING_SCHEDULE_MINUTE=0
DAILY_CALL_COACHING_TIME_ZONE=America/Toronto
DAILY_CALL_COACHING_LOOKBACK_DAYS=1
```

Internal operational interfaces:

- SQLite table: `scheduled_job_runs`
- Scheduled call-import route: `POST /api/scheduled/call-activity-sync/run`
- Scheduled coaching route: `POST /api/scheduled/daily-call-coaching/run`
- Cron trigger scripts:
  - `node scripts/trigger-call-activity-sync.cjs`
  - `node scripts/trigger-daily-call-coaching.cjs`

Render should run the two cron services every 15 minutes. The routes decide whether the Toronto schedule window is due and use `scheduled_job_runs` for per-date idempotency.

Manual verification examples:

```bash
curl -X POST \
  -H "x-call-activity-sync-secret: $CALL_ACTIVITY_SYNC_SECRET" \
  "$APP_BASE_URL/api/scheduled/call-activity-sync/run"

curl -X POST \
  -H "x-daily-call-coaching-secret: $DAILY_CALL_COACHING_SECRET" \
  "$APP_BASE_URL/api/scheduled/daily-call-coaching/run"
```

Expected outcomes:

- call import advances `call_ingest_state.last_recent_sync_at` through the current Toronto business date
- post-call sync drains to `remainingCount = 0`
- daily coaching runs only after coverage is complete
- each rep gets at most one live coaching email per report date
- stale import or missed live-send windows are surfaced by the watchdog

If you deploy this Docker image on Railway with a mounted volume, also set:

```bash
RAILWAY_RUN_UID=0
```

Railway mounts volumes as `root`, and their docs note that non-root Docker images need this override to write to the attached volume.

You can use `/api/health` as a basic healthcheck endpoint after deployment.

Build and run locally with Docker:

```bash
docker build -t business-accounts-app .
docker run --rm -p 3000:3000 \
  -e ACUMATICA_BASE_URL=... \
  -e ACUMATICA_COMPANY=... \
  -e READ_MODEL_SQLITE_PATH=/app/data/read-model.sqlite \
  -e DATA_QUALITY_HISTORY_PATH=/app/data/data-quality-history.json \
  business-accounts-app
```

## Notes

- Contact fields are read-only if Acumatica has no `PrimaryContact.ContactID`.
- RocketReach enhancement is manual and draft-only. It fills only missing contact name, job title, email, or phone fields in the `/accounts` drawer, and nothing is written until you click `Save changes`.
- OpenAI company attribute suggestion is manual and draft-only. It looks up public web information, uses MeadowBrook's postal-code region map, fills only missing Company Region, Category, Industry Type, or Sub-Category in the `/accounts` drawer, shows source links, and nothing is written until you click `Save changes`.
- No local/offline save fallback: errors are returned directly from API/save flow.
