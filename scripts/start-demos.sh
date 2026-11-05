#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

stop_port() {
  local port="$1"
  local pid
  pid=$(ss -ltnp 2>/dev/null | grep ":$port" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  if [ -n "${pid:-}" ]; then
    echo "Stopping port $port (pid $pid)"
    kill "$pid" || true
    sleep 1
  fi
}

for port in 3290 3291 3292; do
  stop_port "$port"
done

if [ ! -f data/africoach-demo.db ]; then
  echo "Seeding Africoach demo database"
  DB_PATH=data/africoach-demo.db npx tsx scripts/seed-africoach.ts
fi

if [ ! -f data/jabulani-demo.db ]; then
  echo "Seeding Jabulani Boards demo database"
  DB_PATH=data/jabulani-demo.db npx tsx scripts/seed-jabulani.ts
fi

npm run build

echo "Starting Africoach backend on :3291"
env NODE_ENV=production PORT=3291 DB_PATH=data/africoach-demo.db \
  JWT_SECRET='africoach-demo-local-secret-2026-please-change' \
  APP_URL='http://africcoach.localhost:3290' ALLOW_LOCAL_APP_URL=true LOG_LEVEL=info \
  node dist/server.js > /tmp/opencode/africoach-demo.log 2>&1 &
AFRICOACH_PID=$!

echo "Starting Jabulani backend on :3292"
env NODE_ENV=production PORT=3292 DB_PATH=data/jabulani-demo.db \
  JWT_SECRET='jabulani-demo-local-secret-2026-please-change' \
  APP_URL='http://jabulani-boards.localhost:3290' ALLOW_LOCAL_APP_URL=true LOG_LEVEL=info \
  node dist/server.js > /tmp/opencode/jabulani-demo.log 2>&1 &
JABULANI_PID=$!

echo "Starting host proxy on :3290"
node scripts/demo-proxy.mjs > /tmp/opencode/demo-proxy.log 2>&1 &
PROXY_PID=$!

cleanup() {
  kill "$AFRICOACH_PID" "$JABULANI_PID" "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Demos:"
echo "  http://africcoach.localhost:3290"
echo "  http://jabulani-boards.localhost:3290"
echo "Logs: /tmp/opencode/{africoach-demo,jabulani-demo,demo-proxy}.log"
echo "Press Ctrl-C to stop all three."

wait
