#!/bin/sh
# Marsh one-shot installer: clone → ./install.sh → open Marsh.app
# Idempotent; installs missing prerequisites via Homebrew, registers the
# plugin, writes per-operator config, builds the dock app.
set -u
HUB="$(cd "$(dirname "$0")" && pwd)"
cd "$HUB"
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
todo() { printf '  \033[33m→\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; }

echo "Marsh install — $HUB"

# 1. prerequisites
command -v brew >/dev/null 2>&1 || { fail "Homebrew required: https://brew.sh"; exit 1; }
for f in tmux ttyd gh; do
  command -v "$f" >/dev/null 2>&1 || { echo "  installing ${f}…"; brew install -q "$f"; }
  ok "$f"
done
command -v node >/dev/null 2>&1 && node -e 'process.exit(+process.versions.node.split(".")[0]>=20?0:1)' \
  || { echo "  installing node…"; brew install -q node; }
ok "node $(node --version 2>/dev/null)"
command -v python3 >/dev/null 2>&1 && ok "python3" || { fail "python3 missing"; exit 1; }
if ! command -v claude >/dev/null 2>&1; then
  todo "Claude Code not found — installing…"
  curl -fsSL https://claude.ai/install.sh | bash || { fail "install Claude Code manually: https://claude.com/claude-code"; exit 1; }
fi
ok "claude $(claude --version 2>/dev/null | head -1)"

# 2. plugin registration (idempotent)
claude plugin marketplace add "$HUB" >/dev/null 2>&1 || true
claude plugin install marsh@marsh >/dev/null 2>&1 || true
ok "plugin marsh@marsh registered"

# 3. per-operator config: find the workspace root holding the target repos
if [ ! -f config/operator.json ]; then
  SENTINEL=$(python3 -c "import json;print(next(iter(json.load(open('config/registry.json'))['repos'])))" 2>/dev/null || echo "")
  PARENT="$(dirname "$HUB")"
  ROOT=""
  for cand in "$PARENT" "$HOME/Code" "$HOME/code" "$HOME/dev" "$HOME/src"; do
    [ -n "$SENTINEL" ] && [ -d "$cand/$SENTINEL" ] && ROOT="$cand" && break
  done
  if [ -z "$ROOT" ]; then
    printf '  Workspace root (directory containing %s etc.): ' "$SENTINEL"
    read -r ROOT
  fi
  if [ -n "$SENTINEL" ] && [ -d "$ROOT/$SENTINEL" ]; then
    printf '{ "workspaceRoot": "%s" }\n' "$ROOT" > config/operator.json
    ok "config/operator.json → workspaceRoot: $ROOT"
  else
    todo "repos not found at '$ROOT' — clone them, then write config/operator.json ({\"workspaceRoot\": …})"
  fi
else
  ok "config/operator.json exists"
fi

# 4. hub pointer + always-on board (launchd) — the PWA is the dock app;
# Marsh.app is setup/repair only
mkdir -p "$HOME/.config/marsh" && printf '%s' "$HUB" > "$HOME/.config/marsh/hub"
ok "hub pointer ~/.config/marsh/hub"
[ -f "$HOME/.config/marsh/github-user-token.json" ] && ok "github authorized (Marsh acts as you)" \
  || todo "authorize GitHub once: plugins/marsh/scripts/gh_user_auth.sh (device flow — Marsh acts as YOU, never more)"
# no shared secrets required: device flow uses the public client id only
PLIST="$HOME/Library/LaunchAgents/com.marsh.serve.plist"
mkdir -p "$HOME/Library/LaunchAgents"
NODEDIR="$(dirname "$(command -v node)")"
sed -e "s|__HUB__|$HUB|" -e "s|__NODEDIR__|$NODEDIR|" scripts/com.marsh.serve.plist.template > "$PLIST"
pkill -f "serve.mjs" 2>/dev/null; sleep 1
launchctl unload "$PLIST" 2>/dev/null; launchctl load "$PLIST"
ok "board runs as launchd service (com.marsh.serve, always on)"

# 5. dock app (repair/bringup tool)
sh plugins/marsh/scripts/package_app.sh >/dev/null && ok "built dist/Marsh.app"
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Marsh.app"
cp -R dist/Marsh.app "$HOME/Applications/Marsh.app"
ok "installed ~/Applications/Marsh.app"

echo ""
echo "Done. Next:"
todo "connect the Linear MCP under YOUR account (open claude, run /mcp) — Marsh acts as you"
todo "right-click → Open ~/Applications/Marsh.app once (unsigned first launch), then keep it in the Dock"
todo "in the session: /marsh:status to orient · TEAM_SETUP.md for the multi-operator rules"
