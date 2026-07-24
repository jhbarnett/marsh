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

The **console pane** (toggle top-right) tails the newest local-marsh session
transcript read-only and streams the conversation beside the board; drag a
card onto the compose box to insert a context block, then copy → paste into
the session terminal. When more than one Marsh session is running, pin the
pane with `--session <path-to-transcript.jsonl>` — auto-discovery follows
whichever session wrote most recently and will flip between concurrent ones.
