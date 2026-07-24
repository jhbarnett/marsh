# Marsh — Design

Marsh is an autonomous task-factory teammate. It operates a Linear workspace as a
factory floor — triage → plan → build → verify → ship — across domains (frontend,
backend, db, data science, DevOps, product, security), escalating to a human only
when judgment genuinely requires one.

This document is the architecture of record. Decisions were made 2026-07-23 in a
design interview; the research appendix lists sources.

---

## 1. Principles

1. **Judgment → models, coordination → code.** Routing, scoring, gating, looping,
   WIP limits, and budgets are deterministic scripts and dynamic-workflow
   JavaScript — they spend zero tokens. Agents spend tokens only on bounded acts of
   judgment. (Huryn's 113-agent experiment: 1.95M agent tokens, 0 orchestration
   tokens.)
2. **Linear is the ledger.** Native status *types* (triage/backlog/unstarted/
   started/completed) plus typed comments form the canonical append-only state.
   Every station pass is stateless: it wakes from the issue, does one unit of work,
   exits with a typed comment and possibly a status transition. Crash recovery =
   re-read the issue. (Anthropic Managed Agents: event log + stateless harness +
   `wake(sessionId)`.)
3. **Roles are dispatch contracts, not costumes.** Each hat has scoped inputs (briefs,
   never session history), one owned artifact, a role checklist as its definition of
   done, and a typed exit: `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`.
   The dispatcher wears no hat. (Anti-BMAD/Superpowers: personas without ceremony.)
4. **Human attention is an exception channel, not a pipeline stage.** Wherever risk
   policy allows, adversarial fresh-context review replaces human approval. Humans
   are pulled in for: BLOCKED, plan contradictions, irreversible actions, and the
   risk classes in `config/policy.json`.
5. **Anchors live outside the loop.** Hooks, verification workflows, risk policy,
   and the protocol itself are not editable by working agents — the load-bearing
   defense against reward hacking. (Weng: keep the verifier and permission system
   off the editable surface.)
6. **Escalate by changing something.** On failure: enrich context → change
   approach/model → decompose → human. Never retry unchanged; never silently
   proceed. Witnesses flag stuck work but escalate rather than kill (Gas Town's
   "Serial Killer" lesson).
7. **Parallelize reads, serialize writes.** Research fans out wide; one issue never
   has two code writers. Parallel dev work gets isolated worktrees and serialized
   merges.
8. **Every pass ends by naming the next step.** A completed station pass, command,
   or skill must surface the single recommended next action — the command to run
   or the decision to make — derived from the state it just produced. The conveyor
   never leaves the operator at a dead end; "done" without "next" is an
   incomplete exit.

## 2. Decisions of record (2026-07-23)

| Decision | Choice |
|---|---|
| Name / identity | **Marsh**; own Linear, Slack, and GitHub identities (provisioned by the operator) |
| Trigger model | Hybrid: interactive sessions + scheduled unattended shifts |
| Gates | Risk-scaled (see § 6); plan approval via Linear comment; human holds merge authority |
| Substrate | Local git worktrees for the dev lane; WIP 3–5 dev workstreams + concurrent non-code lanes |
| State machine | Linear status types + typed comments (`protocol.md`); no bespoke label protocol |
| Topology | Hub + repo registry: this repo is the control plane; targets in `config/registry.json` |
| Scout duties | Triage inbox, draft plans, unblock & nudge, backlog gardening, product discovery |
| Discovery output | Evidenced draft issues in Triage (replays, interview quotes, market comps) |
| Console | Workbench kanban — one markdown card per work item (`workbench/cards/`, gitignored: single-operator in-flight state never commits), rendered by `marsh serve`; terminal for live sessions. Dictation-friendly (cards are plain markdown; Wispr Flow into any editor) |
| Surfaces | Workbench decision inbox + push notifications for BLOCKED; Linear comments remain the ledger (audit, portability, future agent identity); Slack shelved |
| Design artifacts | Local-first in `artifacts/`, published as private Claude Artifacts on demand; produced at the plan gate, the review/verify gate, and by discovery/brainstorming; links appended to cards and ledger `refs` |
| Working memory | Disposable SQLite (`var/marsh.db`); Linear remains canonical |
| Portability | `/marsh sync` interprets any workspace's taxonomy into `config/taxonomy.json` |

## 3. Component inventory

### 3.1 Dispatcher
Entry points: `/marsh shift` (headless, scheduled) and `/marsh attach` (interactive).
A deterministic pass that:
1. Checks parked tasks in working memory for satisfied wake conditions (cheap, local).
2. Computes **ready work = unblocked leaves** of Linear's dependency graph
   (sub-issues + blocking relations), per lane.
3. Applies lane WIP limits and per-shift budget from `config/policy.json`.
4. Routes each ready issue by shape × domain × risk (one thin classify-and-act agent
   for ambiguous calls; everything else is table lookup).
5. Launches station passes (workflows or worktree controller sessions).
6. Runs the witness pass (stuck-work detection → escalation, never auto-kill).
7. Writes the shift digest to `reports/` and Slack.

### 3.2 Ledger protocol
See `protocol.md`. Typed comments (`marsh:plan`, `marsh:progress`,
`marsh:verification`, `marsh:elicitation`, `marsh:handoff`, `marsh:triage`,
`marsh:discovery`) with a machine-readable JSON header and human-readable body.
Plan approval = human reply/reaction on the plan comment. Upgrades cleanly to
Linear agent sessions (`@Marsh` delegation, webhooks) once Marsh's Linear app
identity exists — same protocol, push instead of poll.

### 3.3 Roles (`plugins/marsh/agents/` + `config/roles/`)
PM, backend engineer, frontend engineer, security analyst, data scientist, DevOps,
adversarial reviewer. Role file = identity + priorities + owned artifact + checklist
+ typed exit statuses. Dispatcher responses to exits:
`DONE` → next gate · `DONE_WITH_CONCERNS` → note for verify station ·
`NEEDS_CONTEXT` → enrich once, then escalate · `BLOCKED` → escalation ladder.

### 3.4 Stations

| Station | Shape | Pattern |
|---|---|---|
| Triage | `triage-sweep` workflow: classify, size, route, dedupe; anomalies flagged | classify-and-act |
| Plan | `plan-batch` workflow → role hats write specs as `marsh:plan` comments; zero-context plan format (exact paths, Consumes/Produces, no placeholders) | fan-out + sprint contract |
| Build | Per-issue controller session in a worktree: fresh implementer subagent per task → task-reviewer subagent → fix loop; iterate-until-gate Stop hook | loop-until-done (SDD) |
| Verify | `verify-panel` workflow: parallel reviewers → per-finding validators → unvalidated findings dropped; domain verifiers from registry (pytest/ruff/basedpyright, jest/Playwright, security pass) | generate → validate → filter |
| Egress | Skill: push branch, draft PR under Marsh's GitHub identity, status → In Review, `marsh:verification` evidence comment | — |
| Discovery | `discovery-sweep` workflow: PostHog replays/analytics + Playwright sessions + interview transcripts + market research → evidenced Triage issues | fan-out-and-synthesize |

The **sprint contract** rule: acceptance criteria are negotiated at plan time —
the plan states what "done" means and the verify station holds the build to the
plan's contract, not the builder's opinion (generator/evaluator separation).

**Station conduct** (validated in the first dev-lane runs, 2026-07-23; canonical
values in `policy.stationConduct`) — these rules are baked into every
build/verify/plan station prompt:
- **Poll in the foreground, never stop to wait.** A station pass does not end
  its turn to "wait" on CI, test suites, or builds — it polls with bounded
  checks until the result arrives or the timeout escalates. (Three stalls in
  validation before this was hardened.)
- **Flakes need two reruns and a paper trail.** An intermittent failure across
  two reruns is a flake candidate: file/annotate the issue with evidence;
  excluding it from the gate requires human approval — never a silent skip.
- **Degraded gates are policy, not improvisation.** When a repo's canonical
  gate is broken (registry `gateStatus`), the registry's `interimGate` defines
  the accepted evidence basis — stations never invent their own substitute.
- **Deviations on alwaysHuman-class work return to the human** before landing
  in a commit or draft PR — never silently (`escalation.deviationRule`).
- **Checkpoint beats compaction (token economy).** The ledger makes fresh
  wakes cheap and lossless, so context pressure is answered by finishing the
  current unit, writing the handoff, and restarting — not by summarizing a
  full context (`stationConduct.contextStewardship`). For interactive
  sessions where compaction does fire, the hub `CLAUDE.md` carries the
  Compact instructions (preserve gate states/plan constraints/Next; drop
  anything whose canonical copy is on disk or in the ledger) and the
  post-compaction re-grounding rule; the plugin's PreCompact/PostCompact
  hooks log events to `var/compactions.jsonl` for weakness mining. Native
  limits (verified 2026-07-24): the auto-compact threshold is not
  configurable and hooks cannot alter what compaction retains — CLAUDE.md
  is the only steering channel.
- **Relaxations decay; strictness is the default.** Station prompts hardcode
  no flake signatures, failure classes, or interim bars — they read them from
  the registry, so deleting an entry restores the full gate instantly. Every
  relaxation carries a tracking issue (`gateTracking`, `knownFlakes[].tracking`);
  the status/witness pass flags a relaxation STALE the moment its tracking
  issue closes and surfaces the removal edit. An interim bar never outlives
  its cause.

### 3.5 Runbooks (`runbooks/`)
Captured operational procedures — the "signs"/lessons layer made first-class.
One file per procedure (`runbooks/<service>/<task>.md`): frontmatter (service,
tools, risk class), steps with exact commands, verification, rollback, gotchas.
Stations MUST consult matching runbooks before improvising against external
services (AWS, PostHog, EAS, Mailgun, …). Created three ways:
- `/marsh capture` — distill the current session's operations into a runbook draft;
- weakness mining proposes runbooks for repeated failure clusters;
- by hand.

### 3.6 Working memory (`var/marsh.db`, SQLite — disposable)
Linear is canonical; the db is cache and coordination scratch. Deleting it loses
nothing that matters (rebuildable from Linear + git). Tables (see
`plugins/marsh/scripts/db-schema.sql`): `parked_tasks` (issue, reason, wake
condition, payload), `shift_log` / `station_passes` (telemetry for weakness
mining), `briefs` (discovery-relay cache: ~500-token compressed findings passed
between waves), `dedupe_cache` (seen-issue fingerprints).
Parking: a station that hits `NEEDS_CONTEXT` or posts `marsh:elicitation` parks
the task with a wake condition (comment reply, PR merged, timer). Shift start
checks wake conditions locally before any broad Linear polling.

### 3.7 Sync / alignment (`/marsh sync`)
The portability keystone. Introspects a workspace — teams, status names → status
types, label groups, cycles, projects, initiatives — then a judgment agent
*interprets* semantics (e.g., "`plan-ok` marks an approved plan"; "`is-layup`
means small/low-risk") and proposes `config/taxonomy.json` with confidences and
open questions for human confirmation. Re-running detects drift between config
and workspace. The reference mapping (Agents/Planning/Quality/Scope label
groups) is the first taxonomy; the mechanism is generic and later admits other
trackers behind the same interface.

### 3.8 Anchors (`plugins/marsh/hooks/`)
- No-test-weakening: block edits that delete/skip/loosen tests during build passes.
- Protected paths: migrations, auth, infra, and Marsh's own config/hooks require
  the human gate regardless of issue labels.
- Evidence-before-done Stop hook: a build session cannot claim completion without
  verifier output in the transcript.
- Commit-time security review on risky diffs (vendored pattern from the official
  security-guidance plugin: conditioned hooks + async rewake).
Declarative rule files (hookify-style) let new "signs" be added without writing
hook code.

### 3.9 Self-healing
Escalation ladder (§ 1.6) at every station; witness pass each shift with
thresholds from policy; telemetry-driven **weakness mining**: cluster failures
across `station_passes`, propose amendments — prompt changes, new runbooks, new
declarative rules, policy tuning — as PRs to this repo, which the human reviews.
The meta-loop improves the factory; it never edits its own anchors directly.

### 3.10 Workbench console (`workbench/`)
The single-operator control plane — a Trello-style kanban where **each card is its
own markdown file** (`workbench/cards/<issue-id>.md`), gitignored because in-flight
operator state is personal and disposable. Cards are **projections** of the ledger
plus a command inbox, never truth:
- Frontmatter: issue, lane, column (`inbox | ready | in-progress | awaiting-decision
  | in-review | done`), pending gate, refs (branch, PR, artifacts).
- Marsh-owned body sections: Summary, Decision needed (context, options,
  recommendation), Log.
- One human-owned section: **Your reply** — write or dictate a decision/instruction
  there; Marsh consumes it, executes, mirrors the outcome to the Linear ledger, and
  archives the reply into the card's Log.
Conflict rule: ledger + git win; deleting `workbench/cards/` loses nothing (full
regeneration, same as `var/marsh.db`). `marsh serve` renders the cards directory as
a local kanban UI (columns from frontmatter, drag = frontmatter rewrite).
Spike decision (2026-07-23, `reports/board-ui-spike.md`): **thin custom
renderer** — Backlog.md's serializer drops our frontmatter keys on write;
Vibe Kanban is DB-backed, execution-owning, and sunsetting. ~250 LOC:
gray-matter round-trip, server-rendered board, drag rewrites `column:` only,
inline editing bound exclusively to the "Your reply" zone, file-watch + SSE
live reload. Until serve exists, the card files + terminal are the console.

### 3.11 Design artifacts (`artifacts/`)
Visual deliverables are first-class station outputs, local-first
(`artifacts/<issue-id>/…`, tracked), published as private Claude Artifacts only on
demand (sharing, mobile review). Producers:
- **Plan gate** — HTML wireframes/mockups for UI-touching work (approve the look
  alongside the approach); mermaid architecture/flow/ER diagrams for backend/infra.
- **Review/verify gate** — rich verification evidence: annotated screenshots,
  before/after visual diffs, coverage reports.
- **Discovery/brainstorming** — clickable HTML prototypes as evidence for proposed
  gaps; concept boards for brainstorming sessions.
Every artifact is linked from the issue's workbench card and the ledger comment's
`refs`.

## 4. Lanes and WIP

| Lane | Substrate | WIP | Work |
|---|---|---|---|
| dev | git worktrees in target repos | 3 (max 5) | build/verify/egress passes |
| planning | none (Linear + docs) | ~4 | triage, plan drafting, decomposition |
| discovery | none (browser, MCPs) | 2 | gap mining, market research |
| gardening | none | 1 | dedupe, stale review, dependency mapping, digests |

Non-code lanes run concurrently with dev and are limited only by budget.
Merge serialization: one refinery step rebases + merges dev-lane branches in
sequence; conflicts route back to the owning controller.

## 5. State machine

Status *types* (portable), transitions Marsh may perform, with the human gates:

```
 triage ──T──▶ backlog/unstarted ──P──▶ (plan on issue) ──B──▶ started ──V──▶ In Review ──▶ completed
   │            [ready = unblocked leaf]        │                                   │
   └─ duplicate/canceled (proposed, human-confirmed)                                └─ merge = human
 T: triage pass (classify/size/route)   P: plan gate — human or adversarial per risk policy
 B: build (worktree, SDD loop)          V: verify panel gates egress to draft PR
```

Epics decompose into sub-issues that re-enter the pipeline (decomposition depth
capped at one level; one issue = one writer).

## 6. Risk-scaled gates

| Shape / class | Plan approval | PR review | Extra |
|---|---|---|---|
| layup, docs | adversarial agent | human (draft PR) | — |
| spike | adversarial | n/a — output is a document | timeboxed |
| feature, bug | **human** (comment reply) | human | — |
| security, auth, migrations, infra, billing, tenant-scoping | **human** | **human** | security-analyst verifier; protected-path hooks |

All policy lives in `config/policy.json`; nothing is hardcoded.

## 7. Repo layout

```
local-marsh/
├── .claude-plugin/marketplace.json      # local marketplace: "marsh"
├── DESIGN.md · protocol.md · README.md
├── plugins/marsh/
│   ├── .claude-plugin/plugin.json
│   ├── commands/     # /marsh:shift ·status ·attach ·sync ·capture ·triage ·plan ·build ·verify
│   ├── skills/       # station skills (vendored + adapted, self-contained)
│   ├── agents/       # role contracts
│   ├── workflows/    # triage-sweep · plan-batch · verify-panel · discovery-sweep
│   ├── hooks/        # anchors (§ 3.8)
│   └── scripts/      # deterministic helpers: ready-work, ledger parse, db, registry
├── config/
│   ├── registry.json # target repos: path, base branch, verify cmds, domains, teams
│   ├── policy.json   # lanes, WIP, gates, risk classes, budgets, witness thresholds
│   ├── taxonomy.json # generated by /marsh sync, human-confirmed
│   └── roles/        # per-hat checklists and definitions of done
├── runbooks/         # captured operational procedures
├── workbench/        # console: cards/ (gitignored kanban of markdown cards) + README
├── artifacts/        # design artifacts per issue (tracked, local-first)
├── reports/          # shift digests (tracked — greppable history)
└── var/              # SQLite working memory (gitignored, disposable)
```

Portability: `plugins/marsh/` contains nothing workspace-specific. A new adopter
clones, runs `/marsh sync`, fills `registry.json`, and tunes `policy.json`.

## 8. Build sequence

- **Phase 0** — scaffold, DESIGN.md, protocol.md, config schemas. *(this commit)*
- **Phase 1** — read-only Marsh: `/marsh status`, `/marsh sync`, triage sweep in
  dry-run (proposals in digest, no writes); workbench card projection (read-only
  console); board-UI spike (adopt Backlog.md/Vibe Kanban vs thin `marsh serve`).
  Trust calibration.
- **Phase 2** — Scout live: triage writes, plan drafting, unblock nudges,
  gardening; parking + wake conditions; decision consumption from card reply
  zones; `marsh serve` (or adopted board) rendering the cards.
- **Phase 3** — dev lane on layups end-to-end (worktree → SDD → verify → draft
  PR) at WIP 1; raise toward 3–5 with the refinery; plan-gate wireframes and
  verify-gate evidence artifacts.
- **Phase 4** — full risk matrix; discovery duty (with clickable prototypes);
  Marsh identities (Linear agent app, GitHub account); scheduled shifts.
- **Phase 5** — weakness mining and policy-tuning PRs (self-improvement).

## 9. Research appendix

Patterns adopted, with primary sources:
- Ralph loop (stateless restarts, state-on-disk, one-thing-per-loop, backpressure):
  ghuntley.com/ralph · anthropics/claude-code ralph-wiggum plugin (Stop-hook mechanics)
- Orchestrator patterns, evaluator-optimizer, effort scaling:
  anthropic.com/engineering/building-effective-agents · built-multi-agent-research-system
- Long-running harnesses, generator/evaluator separation, sprint contracts:
  anthropic.com/engineering/effective-harnesses-for-long-running-agents ·
  harness-design-long-running-apps · building-c-compiler
- Event-sourced sessions, stateless wake, cattle-not-pets sandboxes:
  anthropic.com/engineering/managed-agents
- Self-improving harnesses, weakness mining, anchors off the editable surface:
  lilianweng.github.io/posts/2026-07-04-harness
- Tracker-as-protocol, delegate-not-assignee, typed activities:
  linear.app/developers/agents · linear.app/developers/agent-interaction
- Judgment/coordination split, six workflow patterns:
  productcompass.pm/p/claude-code-dynamic-workflows · code.claude.com/docs/en/workflows
- Parallel-fleet mechanics (discovery relay, scope claims, consistency voting,
  speculative mode): github.com/SethGammon/Citadel (docs/FLEET.md)
- Ticket-to-PR gating (plan comment, draft PR, confidence, downgrade paths):
  docs.devin.ai · Sweep · OpenHands resolver · Gas Town post-mortems
  (yegge.ai/gastown · tenzinwangdhen.com/posts/gastown-good-bad-ugly)
- Role-contract design rules (steal/avoid): Superpowers v6.1.1
  subagent-driven-development (vendor) · BMAD-METHOD v6 persona/template analysis
- Don't parallel-write one task: cognition.com/blog/dont-build-multi-agents
