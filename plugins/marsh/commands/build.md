---
description: Build station — implement an approved plan in an isolated worktree, pass the verify gate, ship a draft PR with ledger evidence
argument-hint: "<ISSUE-ID>"
---

# /marsh:build — build station

You are Marsh's build-station controller for ONE issue. Run from the marsh
hub repo. Load `config/taxonomy.json`, `config/policy.json`, the issue's repo
entry from `config/registry.json`, and re-read `protocol.md` §2 from the hub
before posting any comment.

## Preconditions (verify, don't assume)

- Plan approved per policy for this shape/risk class (`marsh:plan` comment +
  required approval). No approved plan → STOP; `Next: /marsh:plan <id>`.
- Issue unblocked; dev-lane WIP slot free (`policy.lanes.dev`).
- **Claim atomically**: status → In Progress AND assignee → Marsh identity
  (or the operator, pre-identity) in the same pass. If currently assigned to
  another human: post `marsh:elicitation` to confirm takeover — do not claim
  silently. Post a `marsh:progress` comment (v2, `status:"STARTED"`) with
  branch/worktree refs.

## Build contract (dispatch to the implement agent)

> Implement the issue exactly per the approved plan, verify, and open a draft
> PR. Work ONLY inside a fresh git worktree — never modify the main checkout,
> never push to the base branch, never merge anything.
> Setup: fetch, then `git worktree add .claude/worktrees/<issue-id> -b
> marsh/<issue-id>-<slug> origin/<baseBranch>` in the registry repo.
> Follow the plan, adapting only to what the actual code requires. Deviations:
> minor → record in your report and the PR body; anything touching an
> alwaysHuman risk class (`policy.riskClasses`) → STOP and return to the
> human before it lands in a commit (`escalation.deviationRule`).
> CRITICAL PROCESS RULE: never end your turn to "wait" for anything — run
> every command to completion in the foreground (long timeouts, or a Bash
> loop of sleep+check within one call). If a gate command hangs (no log
> progress for 10+ minutes), kill it, capture the partial log, and report
> BLOCKED with that evidence. Your turn ends only with the final report.

## Verify gate

- Run the registry `verify.gate` command. It must pass; fix and re-run at
  most 2 attempts, then STOP — do not push — and report BLOCKED with the
  exact failing output.
- Registry `gateStatus` degraded → the registry `interimGate` defines the
  evidence bar (e.g. targeted tests for touched modules + baseline parity
  with the base branch + green CI). Establish each element explicitly; a
  failure outside the registry's `knownEnvironmentalFailureClasses` that
  touches your change → fix it or BLOCKED. Never invent a substitute gate.
- Flakes: a failure matching a registry `knownFlakes` signature on untouched
  suites may be rerun up to `policy.stationConduct.flakeRetries` times (free,
  not fix attempts). Persisting → annotate the tracking issue with evidence;
  excluding anything from the gate requires human approval.
- Never delete, skip, or weaken a test to pass the gate.

## Panel review (after the gate, before shipping)

Run the verify panel: Workflow with
`scriptPath: ${CLAUDE_PLUGIN_ROOT}/workflows/verify-panel.js` and args
`{repo, worktree, baseBranch, branch, issueId, planContract}` (panel lenses
default sensibly; trim to 2 lenses for layups/docs). Confirmed BLOCKER →
one fix round through the implement agent, re-gate, re-panel the fix; still
blocked → report BLOCKED. Confirmed MAJOR/MINOR → fix if trivial, otherwise
carry into the PR body as known findings and exit DONE_WITH_CONCERNS.

## Ship + exit

1. Commit (repo's message conventions; include `Co-Authored-By` if the repo
   uses it), `push -u`, `gh pr create --draft` — body: summary, plan link,
   verification evidence, panel findings, deviations, `Closes <issue-id>`.
   **Title lint (hard rule, include verbatim in every implement-agent
   dispatch): neither the commit subject nor the PR title may contain an
   issue identifier** — check both against `[A-Z]+-[0-9]+` before pushing.
   Linear attaches by title and can yank statuses (CORE-939, then again on
   #1959/#1181 after the rule existed but wasn't in the dispatch template).
   After the PR attaches, Linear's Git automation may race your status
   write — re-fetch the issue and re-save if reverted
   (taxonomy `linearQuirks.gitAutomationRace`).
2. Status → In Review; post `marsh:verification` comment (v2) with the gate
   evidence, panel counts, and PR URL in refs.
3. **Project the card**: write the issue snapshot to `var/` and run
   `project_cards.py` so the workbench reflects the exit state — with
   `gate: null`. A shipped draft PR is the in-review column (normal review
   backlog), not an awaiting-decision gate; `gate` is reserved for decisions
   that block Marsh mid-flight (plan approval, elicitation, takeover,
   deviation sign-off).
4. Controller report (data, not prose): STATUS
   (DONE | DONE_WITH_CONCERNS | BLOCKED), PR URL, branch, files changed with
   +/- counts, verify-gate tail, deviations and why, concerns.

## Next step (required)

End with `Next:` — e.g. `Next: review draft PR #N (merge authority is
human)`, or on BLOCKED the single unblocking action.

Telemetry: after each pass, `sh "${CLAUDE_PLUGIN_ROOT}/scripts/log_pass.sh" <issue> build <EXIT> "<one-line note incl. tool friction>"`.
