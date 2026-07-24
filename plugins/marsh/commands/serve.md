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

The compose box works with both: drag a card in for a context block, then
**send** (types the text into the tmux session via `send-keys` — never
presses Enter; you review and submit in the terminal) or **copy** for manual
paste.
