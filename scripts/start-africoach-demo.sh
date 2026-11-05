#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3290}"
DB_PATH="${DB_PATH:-data/africoach-demo.db}"
LOG="${LOG:-/tmp/opencode/africoach-demo.log}"

if [ ! -f "$DB_PATH" ]; then
  echo "Demo database not found at $DB_PATH"
  echo "Seed it first:"
  echo "  DB_PATH=$DB_PATH npx tsx scripts/seed-africoach.ts"
  exit 1
fi

# Stop an existing demo instance on the same port.
PID=$(ss -ltnp 2>/dev/null | grep ":$PORT" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
if [ -n "${PID:-}" ]; then
  echo "Stopping existing demo on port $PORT (pid $PID)"
  kill "$PID" || true
  sleep 1
fi

npm run build

echo "Starting Africoach demo on http://africcoach.localhost:$PORT"
echo "Logs: $LOG"
exec env \
  NODE_ENV=production \
  PORT="$PORT" \
  DB_PATH="$DB_PATH" \
  JWT_SECRET="${JWT_SECRET:-africoach-demo-local-secret-2026-please-change}" \
  APP_URL="http://africcoach.localhost:$PORT" \
  ALLOW_LOCAL_APP_URL=true \
  LOG_LEVEL="${LOG_LEVEL:-info}" \
  node dist/server.js >"$LOG" 2>&1
