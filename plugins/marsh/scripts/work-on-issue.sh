#!/usr/bin/env bash
#
# Linear "Work on issue → Custom script" → a Marsh station session for the issue.
# Repurposed from agent-ops/services/linear (the pre-Marsh iteration).
#
# Linear's DESKTOP app opens a terminal and runs this with LINEAR_* vars
# injected (wire it in ~/.linear/coding-tools.json — see
# runbooks/internal/linear-work-on-issue.md). Event-driven dispatch with zero
# hosting: per-operator, per-click, access bounded by the operator by
# construction.
#
# Unlike the original, no repo map is needed: the session starts in the MARSH
# HUB and the station contracts resolve the target repo from the registry.
#
set -euo pipefail

# Linear's desktop app does not inherit your interactive shell PATH on macOS.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
CLAUDE="$(command -v claude || true)"; [ -n "$CLAUDE" ] || CLAUDE="$HOME/.local/bin/claude"

LOG="${MARSH_WOI_LOG:-$HOME/.config/marsh/work-on-issue.log}"
issue="${LINEAR_ISSUE_IDENTIFIER:-}"

fail() {
  printf '[%s] FAILED issue=%s reason=%s\n' "$(date '+%F %T')" "$issue" "$1" >>"$LOG" 2>&1 || true
  { echo ""; echo "  Linear → Marsh bridge: $1"; echo ""; } >&2
  read -r -t 30 -p "  press Enter to close " _ || true
  exit 1
}

# Hub resolution: same chain as the Marsh.app launcher.
HUB="${MARSH_HUB:-}"
[ -z "$HUB" ] && HUB="$(cat "$HOME/.config/marsh/hub" 2>/dev/null || true)"
if [ -z "$HUB" ] || [ ! -f "$HUB/protocol.md" ]; then
  for c in "$HOME/Code/marsh-agent" "$HOME/code/marsh-agent" "$HOME/dev/marsh-agent" "$HOME/src/marsh-agent"; do
    [ -f "$c/protocol.md" ] && HUB="$c" && break
  done
fi
[ -n "$HUB" ] && [ -d "$HUB" ] || fail "marsh hub not found — run install.sh in your marsh-agent clone"
[ -n "$issue" ] || fail "no LINEAR_ISSUE_IDENTIFIER from Linear"

mkdir -p "$(dirname "$LOG")"
cd "$HUB"

prompt="${LINEAR_CLAUDE_PROMPT:-Route Linear issue ${issue} to the correct Marsh station and run it: an approved plan on a committed (Todo) issue means the /marsh:build contract; otherwise /marsh:plan ${issue}. Honor every gate — this click is dispatch, not approval.}"
printf '[%s] launch issue=%s hub=%s\n' "$(date '+%F %T')" "$issue" "$HUB" >>"$LOG" 2>&1

# Detached session (survives this window), then attach so this window is live.
out="$("$CLAUDE" --bg --name "marsh-$issue" "$prompt" 2>&1)" || { printf '%s\n' "$out" >>"$LOG"; fail "claude --bg failed (see $LOG)"; }
printf '%s\n' "$out" >>"$LOG" 2>&1
esc=$'\033'
id="$(printf '%s' "$out" | sed -E "s/${esc}\[[0-9;]*m//g" | sed -nE 's/.*attach[[:space:]]+([0-9a-f]{6,}).*/\1/p' | head -1)"
if [ -n "$id" ]; then exec "$CLAUDE" attach "$id"; else exec "$CLAUDE" agents; fi
