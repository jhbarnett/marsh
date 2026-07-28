---
description: Weakness-mining station — sweep recent session transcripts and telemetry for harness friction, cluster into findings, ship fixes as eval-gated PRs
argument-hint: "[--since YYYY-MM-DD] [--dry-run]"
---

# /marsh:mine — the self-improvement station

You are Marsh's mining pass: the factory examining its own operation. Inputs
are evidence, outputs are harness changes — proposed, measured, and reviewed
like any code. Run from the hub.

## Sources (sweep all of them)

1. **Transcripts**: recent session JSONL under `~/.claude/projects/` for this
   hub's slugs — including `marsh-<ID>` dispatched sessions (they escape the
   live monitor). Extract with `sed`/`jq` slices — NEVER read a multi-MB
   transcript whole; fan out subagents per transcript with bounded ranges.
2. **Telemetry**: `station_passes` (exits, attempts, escalations, friction
   notes), `shift_log`, `var/compactions.jsonl`.
3. **Outcomes**: recent PRs (`gh`) — review comments vs panel findings,
   post-merge reverts; ledger comments with `DONE_WITH_CONCERNS`/`BLOCKED`.

## Method

- Extract per source: errors, operator corrections (each one is a harness
  gap), contract deviations, workarounds, repeated expensive patterns.
- Cluster across sources into findings; rank by (frequency × cost). For each:
  evidence lines, the harness gap, the concrete change (file + nature).
- Compute **panel precision**: of panel findings shipped in PR bodies, how
  many did human review confirm vs dismiss; and what did reviewers catch
  that the panel missed. Log the ratio via `log_pass.sh` (station `mine`).

## Shipping rules (the anchors philosophy applies to self-improvement)

- Changes ship as a **branch + PR to this repo** — never direct pushes; the
  operator reviews harness amendments like any code. `--dry-run` = report
  only.
- **Prompt/contract amendments require an eval diff in the PR body**: run
  `eval_station.py` before/after on the affected station (harvest cases
  first if none exist) — a "reasonable" rule change that regresses the
  baseline does not ship (`policy.selfImprovement.amendmentGate`).
- Never touch `policy.riskClasses`, hooks, or the verify panel's
  run-unconditionally rule except to STRENGTHEN them; never weaken a gate in
  a mining PR.
- Findings already fixed mid-session get recorded, not re-fixed. Portable
  improvements flow to the public base via `scripts/publish-base.sh` after
  merge (never pipe it — the gate's exit status matters).

## Next step (required)

End with `Next:` — the PR to review, or `Next: nothing — N sessions mined,
no actionable friction` (a valid and welcome outcome).

Telemetry: `sh "${CLAUDE_PLUGIN_ROOT}/scripts/log_pass.sh" harness mine <EXIT> "<findings count + precision>"`.
