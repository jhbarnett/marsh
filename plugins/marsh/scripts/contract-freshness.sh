#!/bin/sh
# UserPromptSubmit hook: deterministically tell a session when Marsh contracts
# changed since it last checked — running sessions never re-read files on
# their own (wave-2 lesson: rules shipped mid-session were invisible and
# violations propagated into dispatch prompts). Fail-safe: always exit 0.
payload=$(cat 2>/dev/null || echo '{}')
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id" *: *"\([^"]*\)".*/\1/p')
common=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
hub=$(cd "$(dirname "$common")" 2>/dev/null && pwd) || exit 0
[ -f "$hub/protocol.md" ] || exit 0
latest=$(git -C "$hub" log -1 --format=%H -- protocol.md plugins/marsh/commands config/policy.json config/taxonomy.json 2>/dev/null)
[ -n "$latest" ] || exit 0
mkdir -p "$hub/var" 2>/dev/null || exit 0
mark="$hub/var/.contracts-seen-${sid:-anon}"
seen=$(cat "$mark" 2>/dev/null || echo none)
echo "$latest" > "$mark"
[ "$seen" = "$latest" ] && exit 0
[ "$seen" = "none" ] && exit 0
files=$(git -C "$hub" log --format= --name-only "$seen..$latest" -- protocol.md plugins/marsh/commands config 2>/dev/null | sort -u | grep -v '^$' | head -8 | tr '\n' ' ')
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"MARSH CONTRACTS UPDATED since this session last checked: %s— re-read protocol.md and the relevant plugins/marsh/commands/*.md from the hub before your next ledger write or dispatch. Dispatch prompts must embed the current rules verbatim; rules not in the dispatch do not bind the worker."}}\n' "$files"
exit 0
