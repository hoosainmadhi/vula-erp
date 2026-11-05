#!/bin/sh
set -eu

DB_PATH="${DB_PATH:-/data/vula-erp.db}"
export DB_PATH

mkdir -p "$(dirname "$DB_PATH")"

if [ ! -f "$DB_PATH" ] && [ -n "${SEED_SCRIPT:-}" ]; then
  echo "Seeding $DB_PATH with dist/scripts/${SEED_SCRIPT}.js"
  node "dist/scripts/${SEED_SCRIPT}.js"
fi

# Idempotent: adds expenses, attendance and bank data to existing demo volumes.
if [ -n "${SEED_SCRIPT:-}" ] && [ -f "dist/scripts/seed-demo-extras.js" ]; then
  node dist/scripts/seed-demo-extras.js
fi

exec node dist/server.js
