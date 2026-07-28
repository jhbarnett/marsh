---
description: Board refresh — reconcile workbench cards with Linear (active ∪ carded snapshot, prune) so out-of-band changes appear without being called out. Headless-capable, cheap.
---

# /marsh:refresh — board reconciliation

You are Marsh's board-refresh pass: read-only against Linear, writes only
cards. Run from the hub. Designed to be cheap (small model, minimal fields)
because serve triggers it on an interval and from the board's ↻ button.

## Steps

1. List `workbench/cards/*.md` identifiers (the carded set).
2. Fetch via Linear MCP, minimal fields (identifier, title, team, state
   name+type, labels, priority, assignee, url, updatedAt):
   - every carded issue (they may have closed/moved out-of-band), and
   - active issues per team (triage-type + unstarted + started buckets,
     limit ~50 each), and
   - **everything assigned to the operator** (`assignee: me`, any
     non-terminal status including Backlog) — out-of-band assignments are
     personally relevant regardless of status and must surface without
     being called out.
3. Build the snapshot (active ∪ carded — see `project_cards.py` docstring),
   write `var/board-snapshot.json`, run
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/project_cards.py" var/board-snapshot.json --prune-done-days 7`.
4. **Parked comment-reply wakes**: for `parked_tasks` rows with
   `wake_kind='comment_reply'` and no `woken_at`, check the referenced
   issue/comment for replies newer than `parked_at`. Condition met →
   `UPDATE parked_tasks SET woken_at=datetime('now') …`,
   `project_cards.py --set <ID> gate=woken:<reason>`, and include it in the
   output line. Wake = surface only — never dispatch work from this pass.
5. Output ONE line: `refreshed N cards · X moved · pruned Y` (name the moved
   issues). No report, no digest, no Linear writes, no gate changes —
   reconciliation only (existing `gate`/`gateSince` semantics are preserved
   by the projector).

Telemetry: `sh "${CLAUDE_PLUGIN_ROOT}/scripts/log_pass.sh" board refresh DONE "<the one line>"`.
