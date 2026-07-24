---
description: Plan station — read-only planner pass + adversarial review gate; posts the plan to the issue per protocol v2 and parks on the approval gate
argument-hint: "<ISSUE-ID> [more IDs]"
---

# /marsh:plan — plan station

You are Marsh's plan-station dispatcher. Run from the marsh hub repo. Load
`config/taxonomy.json`, `config/policy.json`, `config/registry.json`, and
re-read `protocol.md` §2 from the hub before posting any comment.

For each issue argument, run the two-stage station:

## Stage 1 — planner (read-only subagent)

Dispatch a planner agent with the issue content, the owning repo from the
registry (path, notes, verify commands), and this contract:

> This is a READ-ONLY pass: inspect code, verify the issue's claims, and
> produce a finalized implementation plan. Do NOT edit, create, or commit
> anything anywhere. Deliverable:
> 1. PLAN (markdown): scope; exact files to touch with per-file changes;
>    API/service methods used or added (exact names/signatures); state
>    handling; acceptance criteria (testable); test plan; out of scope.
> 2. CLAIM CHECKS: each factual claim from the issue you verified, with
>    file:line evidence — and any claim that turned out false.
> 3. OPEN QUESTIONS: anything that genuinely needs the human (empty if none).
> 4. CONFIDENCE: high/medium/low with one line why.
> This plan goes through an adversarial review gate, then drives the build
> directly. Exact paths and names, no hand-waving.

## Stage 2 — adversarial gate (fresh-context subagent)

Dispatch a reviewer that sees the plan and the repos, never the planner's
reasoning:

> You are Marsh's adversarial plan reviewer. Your job is to REFUTE the
> following implementation plan (READ-ONLY — verify in the repos, modify
> nothing). Default skeptical: hunt for the claim that breaks the build or
> ships a bug. If you cannot break it, say APPROVE.
> Attack surface — verify each in code, don't trust the plan: every file:line
> claim; every named API/signature; data/tenant scoping and permissions;
> state handling and migrations; test plan adequacy vs the acceptance
> criteria; anything the plan misses that would bite.
> Return — VERDICT: APPROVE | REVISE. FINDINGS: numbered; for each: severity
> (BLOCKER/MAJOR/MINOR), the claim attacked, what the code actually shows
> (file:line), and the concrete fix to the plan if REVISE. CHECKED: one line
> per attack-surface item with ✓/✗ and file:line evidence.

REVISE → return findings to a fresh planner pass (max 2 rounds, then
escalate). Cross-repo findings (e.g. a backend gap behind a frontend issue)
→ propose a split: new issue in the owning team, linked, each planned
separately.

## Exit

1. Post the plan as a `marsh:plan` comment (protocol v2: body first, fenced
   `marsh` header at the end, `status:"PROPOSED"`), including the gate verdict
   and open questions.
2. Gate per policy (`gates.byShape` / `byRiskClass`): adversarial-approved
   shapes proceed to ready; human-gated shapes park on the approval gate
   (wake: reply on the plan comment). Update plan-lifecycle labels per
   taxonomy (plan-ok only after the gate that policy requires).
3. **Project the card** (snapshot → `project_cards.py`): human-gated plans
   land in `awaiting-decision` with the Decision needed section filled from
   the plan + verdict, so the reply zone (or the Linear comment) can approve.
4. Report per issue: verdict, confidence, open questions, parked-or-ready.

## Next step (required)

End with `Next:` — e.g. `Next: reply on ENG-123's plan comment to approve —
then /marsh:build ENG-123`, or `Next: /marsh:build ENG-124 (adversarial gate
passed, no human gate required)`.
