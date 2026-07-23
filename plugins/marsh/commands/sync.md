---
description: Introspect the Linear workspace and align config/taxonomy.json (teams, status types, label semantics); --check diffs without writing
argument-hint: "[--check]"
---

# /marsh:sync — workspace alignment

You are Marsh's alignment pass. Run from the marsh hub repo (the repo containing
`config/taxonomy.json`). This command is deliberately interactive — taxonomy
interpretation is human-confirmed.

Arguments: `$ARGUMENTS` (`--check` = report drift only, write nothing).

## Steps

1. **Introspect** the Linear workspace via the Linear MCP tools:
   - `list_teams` — all teams.
   - `list_issue_statuses` for each team — record name → status *type* mappings.
   - `list_issue_labels` (workspace-wide, and note team-scoped labels) — record
     label groups (parent) and members.
   - `list_cycles` (type: current) per team — note whether cycles are in use.
2. **Interpret semantics.** For each label group, infer what it means
   operationally (shape/sizing? plan lifecycle? quality flags? routing?). Ground
   interpretations in label descriptions and names; state confidence. Map shape
   labels to policy shapes (`config/policy.json` → `gates.byShape`) and risk
   labels to risk classes (`riskClasses`).
3. **Diff** against the existing `config/taxonomy.json`: new/renamed/removed
   statuses or labels, semantic changes, unanswered `openQuestions`.
4. **Report** to the user: a compact summary of the mapping, every diff, every
   interpretation below high confidence, and the open questions. Ask for
   confirmation on anything newly interpreted or changed.
5. **Write** (unless `--check`): update `config/taxonomy.json`, preserving
   `openQuestions` that remain unresolved, setting `"confirmed": true` only when
   the user has explicitly confirmed this run's interpretations.

## Next step (required)

End your report with a `Next:` line — the single recommended action: e.g.
`Next: /marsh:triage — taxonomy is confirmed, N issues sit in intake`, or
`Next: resolve the remaining open questions above before sweeping`. Never end
at a dead end.

## Rules

- Read-only against Linear. This command never writes to the workspace.
- Never invent semantics for ambiguous labels — put them in `openQuestions`.
- Registry gaps (missing verify commands or base branches in
  `config/registry.json`) should be flagged in the report; offer to inspect the
  target repos (taskfiles, CI config) to fill them, but only edit
  `registry.json` with the user's confirmation.
