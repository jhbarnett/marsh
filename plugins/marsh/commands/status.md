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
3. **Query Linear** per team (Linear MCP `list_issues`, filter by team + state,
   request minimal fields, limit 50 per bucket):
   - Triage-type status count (intake pressure)
   - Unstarted, not blocked (ready work — check blocking relations on candidates)
   - Started (in progress) and In Review, with `updatedAt` for staleness vs
     `policy.witness.stuckThresholdHours`
   - Issues labeled `plan-mia` (Scout plan-drafting queue depth)
4. **Local state**:
   - Parked tasks: `sqlite3 -json var/marsh.db "SELECT issue_id, lane, reason, wake_kind, parked_at FROM parked_tasks"`
   - Workbench: count cards per column in `workbench/cards/`; list cards with a
     non-empty "Your reply" zone (pending human commands not yet consumed).
5. **Render the report** (terminal markdown):
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
