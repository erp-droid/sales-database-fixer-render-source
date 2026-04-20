#!/usr/bin/env bash
set -u

APP_URL="${APP_URL:-https://sales-meadowb.onrender.com}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-30}"
LOG_FILE="${LOG_FILE:-/Users/jserrano/Sales Database Fixer/tmp/render-502-monitor.log}"
ALERT_FILE="${ALERT_FILE:-/Users/jserrano/Sales Database Fixer/tmp/render-502-alerts.log}"
SLOW_THRESHOLD_MS="${SLOW_THRESHOLD_MS:-4000}"
SERVICE_ID="${SERVICE_ID:-}"
RENDER_API_KEY="${RENDER_API_KEY:-}"

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$ALERT_FILE")"

last_failed_event_id=""
monitor_started_ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

printf '%s monitor_started app=%s interval=%ss\n' "$monitor_started_ts" "$APP_URL" "$INTERVAL_SECONDS" >> "$LOG_FILE"

probe_endpoint() {
  local url="$1"
  local probe_result status_code time_total_s time_ttfb_s time_total_ms time_ttfb_ms

  probe_result="$(curl -sS -o /dev/null -w "%{http_code} %{time_total} %{time_starttransfer}" "$url" || echo "000 0 0")"
  read -r status_code time_total_s time_ttfb_s <<< "$probe_result"
  time_total_ms="$(awk -v sec="$time_total_s" 'BEGIN { printf "%d", sec * 1000 }')"
  time_ttfb_ms="$(awk -v sec="$time_ttfb_s" 'BEGIN { printf "%d", sec * 1000 }')"

  printf '%s %s %s\n' "$status_code" "$time_total_ms" "$time_ttfb_ms"
}

while true; do
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  read -r health_code health_total_ms health_ttfb_ms <<< \
    "$(probe_endpoint "$APP_URL/api/healthz?probe=$(date +%s)")"
  read -r sync_code sync_total_ms sync_ttfb_ms <<< \
    "$(probe_endpoint "$APP_URL/api/sync/status?probe=$(date +%s)")"

  line="$ts healthz=$health_code health_total_ms=$health_total_ms health_ttfb_ms=$health_ttfb_ms sync_status=$sync_code sync_total_ms=$sync_total_ms sync_ttfb_ms=$sync_ttfb_ms"
  echo "$line" >> "$LOG_FILE"

  if (( 10#$health_code >= 500 || 10#$sync_code >= 500 || 10#$health_code == 0 || 10#$sync_code == 0 )); then
    echo "$ts ALERT endpoint_5xx_or_unreachable healthz=$health_code sync_status=$sync_code health_total_ms=$health_total_ms sync_total_ms=$sync_total_ms" | tee -a "$ALERT_FILE" >> "$LOG_FILE"
  fi

  if (( health_total_ms >= SLOW_THRESHOLD_MS || sync_total_ms >= SLOW_THRESHOLD_MS )); then
    echo "$ts ALERT endpoint_slow health_total_ms=$health_total_ms sync_total_ms=$sync_total_ms threshold_ms=$SLOW_THRESHOLD_MS" | tee -a "$ALERT_FILE" >> "$LOG_FILE"
  fi

  if [[ -n "$SERVICE_ID" && -n "$RENDER_API_KEY" ]]; then
    events_json="$(curl -sS "https://api.render.com/v1/services/$SERVICE_ID/events?limit=8" -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" || true)"
    failed_row="$(printf '%s' "$events_json" | jq -r --arg start "$monitor_started_ts" '.[] | select(.event.type=="server_failed" and .event.timestamp >= $start) | [.event.id,.event.timestamp,((.event.details.reason // {})|tostring)] | @tsv' 2>/dev/null | head -n 1)"

    if [[ -n "$failed_row" ]]; then
      failed_id="${failed_row%%$'\t'*}"
      if [[ "$failed_id" != "$last_failed_event_id" ]]; then
        last_failed_event_id="$failed_id"
        echo "$ts ALERT render_server_failed $failed_row" | tee -a "$ALERT_FILE" >> "$LOG_FILE"
      fi
    fi
  fi

  sleep "$INTERVAL_SECONDS"
done
