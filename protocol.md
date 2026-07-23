# The Marsh Ledger Protocol

How Marsh reads and writes state on a Linear issue. The issue **is** the session:
any pass can crash and a successor rehydrates entirely from status + comments.

## 1. Design rules

1. Marsh keys behavior off status **types** (`triage`, `backlog`, `unstarted`,
   `started`, `completed`, `canceled`), never workspace-specific status names.
   Name → type mapping comes from `config/taxonomy.json` (`/marsh sync`).
2. Comments are append-only. Marsh never edits or deletes a prior ledger comment;
   corrections are new entries.
3. Every Marsh comment is dual-audience: a machine-readable header the dispatcher
   parses without an LLM, and a human-readable markdown body.
4. Labels are optional enrichment (mapped via taxonomy), never load-bearing state.

## 2. Comment format

```markdown
<!-- marsh:TYPE {"v":1,"pass":"<station>","issue":"ENG-123","status":"DONE","attempt":1,"refs":{}} -->

## <Human-readable heading>

<body>
```

- The HTML comment is invisible in Linear's UI; humans see only the body.
- `status` uses the typed exit vocabulary: `DONE | DONE_WITH_CONCERNS |
  NEEDS_CONTEXT | BLOCKED` (plus `PROPOSED` for artifacts awaiting a gate).
- `refs` may carry branch, PR URL, worktree, report paths, evidence links.

## 3. Comment types

| Type | Written by | Body contains |
|---|---|---|
| `marsh:triage` | triage pass | classification (shape/domain/size/team), routing, duplicates found, anomalies |
| `marsh:plan` | plan pass | the implementation plan: scope, acceptance criteria (the sprint contract), tasks with exact paths, Consumes/Produces interfaces, open questions |
| `marsh:progress` | build controller | tasks completed this pass, discoveries, remaining work — the handoff brief for the next pass |
| `marsh:verification` | verify panel / egress | evidence: verifier outputs, findings kept vs dropped, coverage, checklist results |
| `marsh:elicitation` | any pass | a structured question for a human: context, the specific decision, options with trade-offs, a recommendation |
| `marsh:handoff` | any pass | state transfer when a pass ends incomplete: what was done, what remains, exact next step |
| `marsh:discovery` | discovery sweep | evidence for a proposed gap: replay links, interview quotes, market comps, confidence |

## 4. Gate semantics

- **Plan gate.** The plan is posted as `marsh:plan` with `status:PROPOSED`.
  - Risk policy says *human*: Marsh proceeds only after a human decision, which
    may arrive on **either surface** — a reply on the plan comment, or the "Your
    reply" zone of the issue's workbench card. Workbench decisions are executed
    and mirrored to the ledger as a comment before Marsh proceeds. A reply with
    changes = revision request → new plan version.
  - Risk policy says *adversarial*: a fresh-context reviewer agent judges the plan
    against the issue and role checklist; its verdict is appended to the plan body.
- **Verify gate.** Egress requires a `marsh:verification` comment whose evidence
  meets the plan's acceptance criteria. No evidence, no PR.
- **Merge.** Always human. Marsh opens draft PRs and links them in `refs`.
- **Elicitation.** Posting `marsh:elicitation` parks the issue (wake condition:
  reply on that comment). Parked issues consume no WIP.

## 5. Status transitions Marsh may perform

| From (type) | To (type) | When |
|---|---|---|
| triage | backlog / unstarted | triage pass accepts + routes |
| triage | canceled / duplicate | **proposed only** — human confirms |
| unstarted | started | build pass claims the issue (assignee/delegate set to Marsh identity) |
| started | In Review (started-type) | egress: draft PR open, verification posted |
| any | — | Marsh never marks `completed`; merge + completion are human acts |

## 6. Wake procedure (rehydration)

A pass rehydrates in this order — cheap to expensive:
1. Local, zero-API: `var/marsh.db` parked-task row (wake condition, payload) and
   the issue's workbench card — an unconsumed "Your reply" zone is a pending
   human command and takes priority.
2. Issue status type + assignee/delegate + relations (blocked-by ⇒ not ready).
3. Ledger comments, newest first: last `marsh:handoff`/`marsh:progress` is the
   resume point; last `marsh:plan` is the contract; human replies since the last
   Marsh comment are new instructions.
4. Repo state: branch named `marsh/<issue-id>-<slug>`, its diff vs base, CI state.
5. Matching runbooks for services the plan touches.

Trust order on conflict: human replies > repo/git state > ledger > db cache.

## 7. Identity

Phase ≤3: comments post via Linear MCP under the operator's auth; bodies are
prefixed `**[Marsh]**` for attribution. Phase 4: Marsh's own Linear app identity —
comments, delegation (`@Marsh`), and agent sessions run under the Marsh actor, and
webhooks replace polling. The ledger format is identical in both phases; only the
author and transport change. GitHub: branches and draft PRs under the Marsh
account from Phase 3 onward. Human-facing urgency travels via the workbench
decision inbox and push notifications, not chat.
