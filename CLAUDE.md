# CLAUDE.md

This is the Marsh hub: the control plane for an autonomous Linear task
factory. Architecture in `DESIGN.md`, ledger protocol in `protocol.md`,
instance bindings in `config/`. Durable state lives in Linear (ledger),
`config/`, `reports/`, and git — the conversation is never the state.

Note: this hub repo is **local-only (no git remote)** — "hub main" means the
local main checkout; `git fetch origin` here fails by design, skip it.

**Worktree sessions**: `config/` edits are only valid on hub main — your
worktree copy is diverged and isolation blocks the hub path. Don't route
around it: surface the exact edit (digest / escalation / card) for the
hub-side session or the operator to apply.

## Token discipline

- Prefer **checkpoint-and-restart over compaction**: durable state is designed
  for cheap rehydration (`protocol.md` §6). If context is heavy mid-work,
  finish the current unit, write the handoff (ledger comment / card / parked
  payload), and start fresh — a wake is lossless; a summary is not.
- Route long outputs to files (`var/`, `reports/`) and reference paths; never
  inline what already lives on disk or in the ledger.
- Fan out reads/research to subagents and workflows; only conclusions belong
  in this session.

# Compact instructions

Preservation priority when space forces choices: user corrections and
decisions > errors and their exact messages > active work state > completed
work (summarize freely). Exact identifiers (issues, PRs, branches, paths)
are always kept verbatim at every tier.

When compacting (automatic or manual), preserve verbatim:
- Active issue IDs with their current station, gate state, and typed exit
  status; branch/worktree paths and PR URLs.
- Approved-plan constraints and acceptance criteria currently being built to.
- Pending human decisions and the current `Next:` action.
- Decisions made this session that are not yet written to config/ledger/memory.

Drop freely: tool outputs whose canonical copy exists on disk or in the ledger
(digests in `reports/`, JSON in `var/`, posted `marsh:*` comments, git diffs) —
keep the path, not the content. Drop exploratory dead ends entirely.

## After any compaction

Re-ground from durable state before continuing: re-read `protocol.md` §2,
the relevant `config/*.json`, and the active issue's ledger/card. Trust
files > ledger > the compaction summary when they disagree.
