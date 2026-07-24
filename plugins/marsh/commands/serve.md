---
description: Start the local workbench kanban board over workbench/cards/ (drag = column change, inline "Your reply" editing, live reload)
argument-hint: "[--port 4643]"
---

# /marsh:serve — workbench board

Start the console UI from the marsh hub repo:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" $ARGUMENTS
```

Run it in the background (`run_in_background`), confirm it's listening by
fetching `http://127.0.0.1:4643/` (or the given port), then tell the user the
URL. The server only ever rewrites a card's `column:` line (drag) or its
"## Your reply" zone (inline edit) — Marsh-owned sections are untouchable
through this surface.

The **console pane** (toggle top-right) has two views:
- **transcript** — tails the newest local-marsh session transcript read-only.
  With multiple sessions running, pin via `--session <transcript.jsonl>` —
  auto-discovery follows whichever wrote most recently.
- **terminal** — embeds the real session over ttyd (fully interactive).
  Setup: `brew install ttyd tmux`, run the Marsh session inside tmux
  (`tmux new -A -s marsh`, then `claude` — or `claude --resume` to migrate an
  existing session), then `ttyd -W -p 4644 tmux attach -t marsh`. Flags:
  `--term <url>` (default `http://127.0.0.1:4644`), `--tmux <name>`
  (default `marsh`).

**Drag a card anywhere over the terminal area** and its context block is
typed directly into the session prompt via `send-keys` — never pressing
Enter; the operator reviews and submits. If tmux is unreachable, the block
falls back to the clipboard. There is no separate compose surface.

Layout: kanban columns render as horizontal rows on top, the session fills
the bottom; the divider drags vertically (persisted). The whole dashboard
and the ttyd terminal share the operator's terminal theme
(`theme_sync.py` → `workbench/theme.json`, Ghostty supported, dark/light
follow system appearance).

One-shot bringup: `plugins/marsh/scripts/marsh-up.sh` (theme sync → tmux
session running claude → themed ttyd → serve → browser; idempotent).
`package_app.sh` wraps that launcher as `dist/Marsh.app` + `Marsh.dmg`.
