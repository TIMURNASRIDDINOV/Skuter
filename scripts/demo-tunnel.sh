#!/usr/bin/env bash
# Expose the local API at the stable public Worker URL.
#
# Starts a Cloudflare quick tunnel to the local API, then points the
# scoot-api Worker (the permanent *.workers.dev URL baked into test builds)
# at the fresh tunnel hostname. Run it again whenever the tunnel drops —
# the app never needs rebuilding.
#
# Usage: scripts/demo-tunnel.sh   (Ctrl-C stops the tunnel)
set -euo pipefail

API_URL="http://localhost:8787"
LOG="$(mktemp)"

curl -sf -m 3 "$API_URL/health" >/dev/null || {
  echo "API is not responding on $API_URL — start it first (pnpm -F @scoot/api dev)" >&2
  exit 1
}

# A leftover tunnel would register a second hostname the Worker doesn't know.
pkill -f "cloudflared tunnel" 2>/dev/null && sleep 2 || true

cloudflared tunnel --url "$API_URL" >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT

echo "Waiting for tunnel URL..."
ORIGIN=""
for _ in $(seq 1 30); do
  ORIGIN=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$ORIGIN" ] && break
  sleep 1
done
[ -n "$ORIGIN" ] || {
  echo "Tunnel URL never appeared — cloudflared log: $LOG" >&2
  exit 1
}

echo "Tunnel up: $ORIGIN"
(cd "$(dirname "$0")/../infra/cloudflare-proxy" && npx wrangler deploy --var ORIGIN_URL:"$ORIGIN")

echo
echo "Stable URL now proxies to this machine. Ctrl-C to stop the tunnel."
wait "$TUNNEL_PID"
