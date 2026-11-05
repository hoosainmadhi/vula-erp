#!/bin/sh
set -eu

DB_PATH="${DB_PATH:-/data/vula-erp.db}"
export DB_PATH

mkdir -p "$(dirname "$DB_PATH")"

if [ ! -f "$DB_PATH" ] && [ -n "${SEED_SCRIPT:-}" ]; then
  echo "Seeding $DB_PATH with dist/scripts/${SEED_SCRIPT}.js"
  node "dist/scripts/${SEED_SCRIPT}.js"
fi

exec node dist/server.js
