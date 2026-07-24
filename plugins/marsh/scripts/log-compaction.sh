#!/bin/sh
# Compaction telemetry: append the hook payload (+timestamp) to
# var/compactions.jsonl in the project cwd. Fail-safe: never blocks
# compaction, always exits 0.
payload=$(cat 2>/dev/null || echo '{}')
dir="var"
mkdir -p "$dir" 2>/dev/null || exit 0
printf '%s\n' "$(printf '%s' "$payload" | tr -d '\n' | sed "s/^{/{\"loggedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",/")" >> "$dir/compactions.jsonl" 2>/dev/null
exit 0
