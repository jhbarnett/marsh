---
description: Read-only factory status — queue health per team/lane, pending decisions, parked tasks, workbench state
---

# /marsh:status — factory floor report

You are Marsh's status pass. Read-only everywhere. Run from the marsh hub repo.

## Steps

1. **Init working memory** (idempotent):
   `sh "${CLAUDE_PLUGIN_ROOT}/scripts/db-init.sh"`
2. **Load config**: `config/taxonomy.json` (teams, status maps),
   `config/policy.json` (lanes, WIP, witness thresholds), `config/registry.json`.
   If taxonomy is missing or `"confirmed": false`, say so and recommend
   `/marsh:sync` — continue with best effort.
3. **Query Linear** per team — PTC discipline: ONE batched `list_issues`
   fetch per team (minimal fields, generous limit), dump raw to `var/`, and
   derive every bucket count and list below in code (`build_briefs.py` /
   python) — never per-bucket MCP calls:
   - Triage-type status count (intake pressure)
   - Unstarted, not blocked (ready work — check blocking relations on candidates)
   - Started (in progress) and In Review, with `updatedAt` for staleness vs
     `policy.witness.stuckThresholdHours`
   - Issues labeled `plan-mia` (Scout plan-drafting queue depth)
4. **Relaxation decay check**: for every registry relaxation (`gateStatus`/
   `interimGate` via `gateTracking`, each `knownFlakes[].tracking`,
   `knownEnvironmentalFailureClasses` via `gateTracking`), fetch the tracking
   issue's status. Tracking issue completed or canceled → the relaxation is
   **STALE-candidate**: list it under "Needs you" with the removal edit —
   but retirement additionally requires **field quiet**: no matching
   signature in any gate run since the closure (check recent
   `station_passes` notes/build evidence). Closure without field quiet is
   not retirement (learned 2026-07-27: the jest-expo relaxation was retired
   on issue closure and the flake recurred 3x the same day — restored,
   follow-up filed). Recurrence after retirement → restore the relaxation
   and file a follow-up tracking issue. A relaxation must never outlive its
   cause — but the field, not the tracker, decides when the cause is gone.
5. **Local state**:
   - Parked tasks: `sqlite3 -json var/marsh.db "SELECT issue_id, lane, reason, wake_kind, parked_at FROM parked_tasks"`
   - Workbench: refresh the board — the snapshot MUST be **active ∪ carded**:
     list `workbench/cards/*.md` identifiers first and fetch the current state
     of every carded issue too (cards whose issues closed since projection are
     otherwise never refreshed — they'd sit stale in awaiting-decision
     forever). Completed/canceled issues project to `done` with `gate: null`.
     Snapshot entries should carry `labels` (array) and `priority` (Linear
     0–4) — projection derives the card's shape glyph, team icon, and
     priority stripe from them via the taxonomy.
     Run `project_cards.py <snapshot> --prune-done-days 7`. Then
     `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/consume_reply.py" --list` for
     pending human commands; pending replies make `/marsh:inbox` the Next.
6. **Render the report** (terminal markdown):
   - One table: team × {triage, ready, in-progress, in-review, plan-mia}
   - Lanes vs WIP: current in-flight per lane against `policy.lanes`
   - **Needs you**: unconsumed card replies, issues past witness thresholds,
     open `taxonomy.openQuestions`
   - A final `Next:` line — the single highest-leverage next action (specific
     command or decision), derived from the state above. Required; never end at
     a dead end.

## Rules

- No writes to Linear, no writes to cards. The db init and read queries are the
  only side effects.
- Keep the report under ~40 lines; detail belongs in `/marsh:triage` digests.
