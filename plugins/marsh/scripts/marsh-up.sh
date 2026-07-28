#!/bin/sh
# One-shot cockpit bringup: theme sync → tmux(+claude) → ttyd → serve → browser.
# Idempotent: running components are left alone. Logs land in var/.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB="${MARSH_HUB:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
TMUXS="${MARSH_TMUX:-marsh}"
SERVE_PORT="${MARSH_PORT:-4643}"
TTYD_PORT="${MARSH_TTYD_PORT:-4644}"
cd "$HUB" || exit 1
mkdir -p var

# 1. theme: extract from the operator's terminal config (best effort)
python3 "$SCRIPT_DIR/theme_sync.py" >/dev/null 2>&1 || true

# 2. tmux session running claude in the hub
if ! tmux has-session -t "$TMUXS" 2>/dev/null; then
  tmux new-session -d -s "$TMUXS" -c "$HUB" 'claude'
  echo "started tmux session '$TMUXS' (claude)"
fi

# 3. ttyd serving the tmux session, themed to match the terminal
if ! pgrep -f "ttyd.*-p $TTYD_PORT" >/dev/null 2>&1; then
  MODE=light; defaults read -g AppleInterfaceStyle 2>/dev/null | grep -q Dark && MODE=dark
  THEME=$(python3 "$SCRIPT_DIR/theme_sync.py" --ttyd "$MODE" 2>/dev/null || echo '{}')
  nohup ttyd -W -p "$TTYD_PORT" -t "theme=$THEME" -t macOptionIsMeta=true tmux attach -t "$TMUXS" >> var/ttyd.log 2>&1 &
  echo "started ttyd :$TTYD_PORT ($MODE theme)"
fi

# 4. the board — auto-bounce when serve.mjs is newer than the running server,
# so "relaunch Marsh.app" is the universal update path
SERVE_PID=$(pgrep -f "serve.mjs" 2>/dev/null | head -1)
if [ -n "$SERVE_PID" ]; then
  MTIME=$(stat -f %m "$SCRIPT_DIR/serve.mjs" 2>/dev/null || echo 0)
  LSTART=$(ps -p "$SERVE_PID" -o lstart= 2>/dev/null)
  START=$(date -j -f "%a %b %e %T %Y" "$LSTART" +%s 2>/dev/null || echo 0)
  if [ "$START" -gt 0 ] && [ "$MTIME" -gt "$START" ]; then
    kill "$SERVE_PID" 2>/dev/null; sleep 1; SERVE_PID=""
    echo "serve.mjs changed since server start — bounced"
  fi
fi
if launchctl list com.marsh.serve >/dev/null 2>&1; then
  : # launchd owns serve (KeepAlive revives it after a bounce) — never double-start
elif [ -z "$SERVE_PID" ]; then
  nohup node "$SCRIPT_DIR/serve.mjs" --port "$SERVE_PORT" --tmux "$TMUXS" >> var/serve.log 2>&1 &
  echo "started marsh serve :$SERVE_PORT"
fi

sleep 1
# Open as a chromeless app window when Chrome is available (dock-app feel);
# MARSH_NO_OPEN=1 skips, MARSH_OPEN=tab forces a normal tab.
PWA=""
for d in "$HOME/Applications/Chrome Apps.localized" "$HOME/Applications/Chrome Apps"; do
  [ -d "$d/Marsh.app" ] && PWA="$d/Marsh.app" && break
done
if [ -n "${MARSH_NO_OPEN:-}" ]; then
  :
elif [ -n "$PWA" ]; then
  open -a "$PWA"   # installed PWA: own dock identity (heron), not Chrome's
else
  # No PWA installed: open a NORMAL tab — a chromeless --app window has no
  # address bar/menu, so the PWA could never be installed from it (catch-22).
  open "http://127.0.0.1:$SERVE_PORT" 2>/dev/null || true
  osascript -e 'display notification "One-time: click the install icon in the address bar (Install Marsh) — then relaunch Marsh.app for its own dock identity" with title "Marsh"' 2>/dev/null || true
  echo "note: PWA not installed — use the address-bar install icon in this tab, then relaunch"
fi
echo "cockpit → http://127.0.0.1:$SERVE_PORT"
