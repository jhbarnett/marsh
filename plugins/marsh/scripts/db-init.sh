#!/bin/sh
# Idempotent working-memory init. Run from the marsh hub repo root.
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p var
sqlite3 var/marsh.db < "$SCRIPT_DIR/db-schema.sql"
echo "ok: var/marsh.db"
