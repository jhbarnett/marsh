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

# 4. the board
if ! pgrep -f "serve.mjs" >/dev/null 2>&1; then
  nohup node "$SCRIPT_DIR/serve.mjs" --port "$SERVE_PORT" --tmux "$TMUXS" >> var/serve.log 2>&1 &
  echo "started marsh serve :$SERVE_PORT"
fi

sleep 1
# Open as a chromeless app window when Chrome is available (dock-app feel);
# MARSH_NO_OPEN=1 skips, MARSH_OPEN=tab forces a normal tab.
if [ -n "${MARSH_NO_OPEN:-}" ]; then
  :
elif [ "${MARSH_OPEN:-app}" = "app" ] && [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="http://127.0.0.1:$SERVE_PORT" 2>/dev/null || open "http://127.0.0.1:$SERVE_PORT"
else
  open "http://127.0.0.1:$SERVE_PORT" 2>/dev/null || true
fi
echo "cockpit → http://127.0.0.1:$SERVE_PORT"
