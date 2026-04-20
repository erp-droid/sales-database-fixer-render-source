# Timeout Health-Check SLO Watchdog

This watchdog is the timeout-focused production SLO guard for `https://sales-meadowb.onrender.com`.

## Trigger Rule

The watchdog runs from Render cron (`sales-meadowb-health-slo-watchdog`) and executes `node scripts/trigger-health-slo-watchdog.cjs`.

Trigger condition:
- Probe endpoint: `/api/healthz`
- Probe timeout budget: `HEALTH_SLO_TIMEOUT_MS` (default `3000` ms)
- Probe attempts per run: `HEALTH_SLO_PROBE_ATTEMPTS` (default `3`)
- Incident trigger: `HEALTH_SLO_CONSECUTIVE_TIMEOUTS` consecutive timeout events (default `2`)
- Additional route anomaly trigger:
  - `/api/healthz` and `/api/sync/status` p99 >= `HEALTH_SLO_ROUTE_P99_THRESHOLD_MS`
  - `/api/healthz` and `/api/sync/status` 5xx count >= `HEALTH_SLO_ROUTE_5XX_THRESHOLD_COUNT`
- Event-loop lag trigger:
  - `lagP99Ms >= HEALTH_SLO_EVENT_LOOP_P99_THRESHOLD_MS` OR
  - `lagMaxMs >= HEALTH_SLO_EVENT_LOOP_MAX_THRESHOLD_MS`
  - Metrics source: `/api/runtime/health-slo` (exported by `server.mjs` runtime monitor)
  - Optional strict mode: `HEALTH_SLO_REQUIRE_RUNTIME_METRICS=true` makes missing runtime metrics a trigger condition.

Timeout events remain a first-class trigger so incidents are not missed when they manifest before broad 5xx bursts.

## Correlated Evidence

When an incident is triggered, the payload includes:
- UTC probe window (`from`, `to`) and per-attempt probe rows
- Consecutive timeout count
- Route p99/5xx summaries for `/api/healthz` and `/api/sync/status`
- Runtime lag snapshot (`lagP99Ms`, `lagMaxMs`) from `/api/runtime/health-slo`
- Render `server_failed` events from the recent lookback window (`HEALTH_SLO_RENDER_EVENT_LOOKBACK_MINUTES`)
- Render event IDs and reason fields when available

## Paging Path

The watchdog posts incident payloads to:
- `HEALTH_SLO_PAGING_WEBHOOK_URL` (required for live paging)
- Optional auth: `HEALTH_SLO_PAGING_WEBHOOK_TOKEN`

Payload destination label defaults to:
- `HEALTH_SLO_INCIDENT_PATH=CTO + DevOps & SRE Engineer incident path`

## Validation

Dry run (no webhook send, forces incident payload output):

```bash
HEALTH_SLO_DRY_RUN=true \
HEALTH_SLO_FORCE_INCIDENT=true \
APP_BASE_URL=https://sales-meadowb.onrender.com \
node scripts/trigger-health-slo-watchdog.cjs
```

Live smoke (real probes, no forced incident):

```bash
APP_BASE_URL=https://sales-meadowb.onrender.com \
node scripts/trigger-health-slo-watchdog.cjs
```
