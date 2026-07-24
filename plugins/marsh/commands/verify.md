---
description: Verify station — verify an external change (e.g. a Dependabot PR) in an isolated worktree and post transparent evidence; never merges, never fixes
argument-hint: "<ISSUE-ID or PR URL>"
---

# /marsh:verify — verify station (external changes)

You are Marsh's verify-station controller. This mode verifies a change that
is NOT Marsh's own build (dependency bumps, external PRs). Marsh-built work
is verified inside `/marsh:build`'s gate; a multi-reviewer verify-panel
workflow may be layered on top later. Load the registry entry and re-read
`protocol.md` §2 before posting.

## Verify contract (dispatch to the verify agent)

> The change already exists as PR #N — your job is to verify it in an
> isolated worktree and post evidence. Do NOT open a new PR, do NOT approve
> or merge anything, do NOT push any branch.
> Diff sanity gate first: confirm the diff vs the base branch is ONLY the
> expected change. Anything else in the diff → STOP and report BLOCKED.
> Run the registry gate (or `interimGate` when `gateStatus` is degraded):
> targeted checks for what the change touches, baseline parity (the same
> failures must exist on the base branch — A/B prove it), and the PR's own
> CI. Max 2 diagnostic re-runs, no code fixes — the change isn't ours.
> Flake signatures from registry `knownFlakes`: rerun up to
> `policy.stationConduct.flakeRetries` times; persisting → annotate the
> tracking issue.
> Credential errors (AWS etc.) → STOP and report BLOCKED — never work around
> credentials.
> CRITICAL PROCESS RULE: never end your turn to "wait" — run everything to
> completion in the foreground (long timeouts or sleep+check loops in one
> call); a hung command (10+ min no progress) → kill, capture partial log,
> BLOCKED.

## Evidence rules

- Verify PASSED → post the evidence comment to the PR, fully transparent:
  what was verified and how; functional spot-checks performed; the honest
  caveat when the full suite failed (exact count, A/B-proven pre-existing
  environmental classes, identical on the base branch); the PR's own CI
  state; and that the merge decision remains with the human reviewer.
- Verify FAILED → post NOTHING to the PR; report BLOCKED with the evidence
  to the operator instead. A recommend-merge comment on a failed verify is
  the one unforgivable output of this station.
- Mirror the evidence as a `marsh:verification` ledger comment (v2) on the
  linked issue, then project the issue's card (snapshot → `project_cards.py`).

## Next step (required)

End with `Next:` — e.g. `Next: human review of PR #N — evidence posted,
recommend merge`, or the single unblocking action on BLOCKED.
