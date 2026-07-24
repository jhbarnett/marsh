#!/bin/sh
# Telemetry: record a station pass. Weakness mining and the eval harness
# feed on these rows. Fail-safe: never blocks the pass.
# Usage: log_pass.sh <issue> <station> <exit_status> [note] [shift_id] [attempt]
[ $# -ge 3 ] || { echo "usage: log_pass.sh <issue> <station> <EXIT> [note] [shift_id] [attempt]" >&2; exit 0; }
issue=$1; station=$2; exit_status=$3; note=${4:-}; shift_id=${5:-adhoc-$(date -u +%Y%m%d)}; attempt=${6:-1}
mkdir -p var 2>/dev/null
sqlite3 var/marsh.db "INSERT OR IGNORE INTO shift_log (shift_id, started_at, mode) VALUES ('$shift_id', datetime('now'), 'adhoc');
INSERT INTO station_passes (shift_id, issue_id, station, attempt, exit_status, notes)
VALUES ('$shift_id', '$(printf '%s' "$issue" | tr -cd 'A-Za-z0-9-')', '$(printf '%s' "$station" | tr -cd 'a-z-')', $attempt, '$(printf '%s' "$exit_status" | tr -cd 'A-Z_')', '$(printf '%s' "$note" | sed "s/'/''/g" | head -c 300)');" 2>/dev/null
exit 0
