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

## 2. Comment format (v2)

````markdown
## <Human-readable heading>

<body>

```marsh
{"v":2,"type":"<TYPE>","pass":"<station>","status":"DONE","attempt":1,"refs":{}}
```
````

- The machine header is a fenced code block with the `marsh` info string,
  placed at the **end** of the comment: humans read the body first, the
  dispatcher parses the tail.
- **Why a fence, not an HTML comment** (v1 lesson, 2026-07-23): Linear renders
  `<!-- -->` as literal text, and auto-expands bare issue identifiers in plain
  text into inline mentions — which corrupts embedded JSON. Fences render
  cleanly and suppress entity expansion.
- **Never put bare issue identifiers, URLs-as-mentions, or `@names` in the
  header.** There is no `issue` field — the comment lives on the issue.
  Cross-issue references go in `refs` as quoted strings.
- `status` uses the typed exit vocabulary: `DONE | DONE_WITH_CONCERNS |
  NEEDS_CONTEXT | BLOCKED` (plus `PROPOSED` for artifacts awaiting a gate,
  `STARTED` for pass-open entries).
- `refs` may carry branch, PR URL, worktree, report paths, evidence links.
- Parsing: last ```` ```marsh ```` fence in the comment body; v1 HTML-comment
  headers may exist in comments from 2026-07-23 — treat as legacy, best-effort.
- **Freshness rule**: any pass that posts ledger comments re-reads this file
  (hub main checkout, not a worktree copy) immediately before its first
  write of the session — the protocol can change under a live session.

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
  **Never put bare issue identifiers in PR titles** — Linear attaches the PR
  and can yank a Done issue back to started (seen on CORE-939). Identifiers
  belong in the PR body (`Closes X` magic words are fine).
- **Elicitation.** Posting `marsh:elicitation` parks the issue (wake condition:
  reply on that comment). Parked issues consume no WIP.
- **Ledger-write pairing.** Any pass that writes the ledger (comment, status
  change, issue creation) projects that issue's card **in the same block** —
  `project_cards.py --set <ID> ...` is one line. The board must never trail
  the ledger. (Wave 2: an entire incident — APP-275 + four sweep issues —
  was ledgered but invisible on the board until the operator noticed.)

## 5. Status transitions Marsh may perform

| From (type) | To (type) | When |
|---|---|---|
| triage | backlog / unstarted | triage pass accepts + routes |
| triage | canceled / duplicate | **proposed only** — human confirms |
| unstarted | started | build pass claims the issue — the claim is atomic: status AND assignee/delegate both update to the Marsh identity (or the operator, pre-identity). If the issue is currently assigned to another human, do not claim silently: post `marsh:elicitation` to confirm takeover, and on approval record the prior assignee in the ledger entry |
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

**Freshness rule for assumed state**: the operator acts out-of-band — files
issues, adds labels, flips PRs to ready — between your reads. Before acting on
state you last wrote or read (an issue's status, a PR's draft-ness, label
sets), re-fetch it. Never treat your own last write as current truth.

## 7. Identity

Phase ≤3: comments post via Linear MCP under the operator's auth; bodies are
prefixed `**[Marsh]**` for attribution. Phase 4: Marsh's own Linear app identity —
comments, delegation (`@Marsh`), and agent sessions run under the Marsh actor, and
webhooks replace polling. The ledger format is identical in both phases; only the
author and transport change. GitHub: branches and draft PRs under the Marsh
account from Phase 3 onward. Human-facing urgency travels via the workbench
decision inbox and push notifications, not chat.
