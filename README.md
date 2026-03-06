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

Recommended production environment values:

```bash
READ_MODEL_SQLITE_PATH=/app/data/read-model.sqlite
DATA_QUALITY_HISTORY_PATH=/app/data/data-quality-history.json
AUTH_COOKIE_SECURE=true
```

If you deploy this Docker image on Railway with a mounted volume, also set:

```bash
RAILWAY_RUN_UID=0
```

Railway mounts volumes as `root`, and their docs note that non-root Docker images need this override to write to the attached volume.

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
- No local/offline save fallback: errors are returned directly from API/save flow.
