# Workbench

The single-operator console: a Trello-style kanban where **each card is its own
markdown file** in `cards/`. Cards are dictation-friendly plain markdown — edit
them in any editor, or through the `marsh serve` board UI.

`cards/` is **gitignored by design**: in-flight operator state is personal and
never commits. Cards are projections of the Linear ledger plus a command inbox —
delete the directory and Marsh regenerates it losslessly.

## Card format (`cards/<issue-id>.md`)

```markdown
---
issue: ENG-123
title: Rate-limit the sync webhook
lane: dev                 # dev | planning | discovery | gardening
column: awaiting-decision # inbox | ready | in-progress | awaiting-decision | in-review | done
gate: plan-approval       # set only while a decision is pending
updated: 2026-07-23T17:40:00Z
refs:
  branch: marsh/eng-123-rate-limit-sync
  pr: null
  artifacts:
    - ../artifacts/ENG-123/webhook-flow.html
---

## Summary
<!-- Marsh-owned: two-sentence state of the work -->

## Decision needed
<!-- Marsh-owned, present only at a gate: context, options with trade-offs,
     Marsh's recommendation. -->

## Your reply
<!-- YOURS. Write or dictate a decision, changes, or instructions here.
     Marsh consumes this zone on its next wake: executes it, mirrors the
     outcome to the Linear ledger, then archives your text into ## Log. -->

## Log
<!-- Marsh-owned: recent station passes and consumed replies, newest first -->
```

## Column semantics

`awaiting-decision` = Marsh is **blocked mid-flight on your input** (`gate`
set: plan-approval, elicitation, takeover, deviation) — stalled WIP, drain
first. `in-review` = Marsh **finished and handed off** (draft PR open,
evidence posted; mirrors Linear "In Review") — your normal review backlog.
Egress clears `gate`; a shipped PR is never an awaiting-decision card.
The converse also holds: **an open elicitation keeps the gate regardless of
issue status** — a Done issue with an unanswered `marsh:elicitation` (e.g.
follow-up filing approval) stays in `awaiting-decision` until the decision is
consumed. Gate = open human decision, not pipeline position.

## Ownership rules

- Marsh owns everything except **`## Your reply`**.
- Column changes you make (frontmatter edit or board drag) are commands: e.g.
  moving a card out of `awaiting-decision` back to `ready` re-queues it.
- On conflict, the Linear ledger + git win. Cards never hold state that exists
  nowhere else.

## Board UI

`marsh serve` renders `cards/` as a local kanban (columns from frontmatter,
drag = frontmatter rewrite). Phase 1 runs a spike on adopting an existing
markdown-kanban tool (Backlog.md, Vibe Kanban) versus a thin custom renderer;
the card format above is stable regardless of the outcome.
