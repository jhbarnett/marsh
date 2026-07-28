# Marsh

An autonomous task-factory teammate for [Claude Code](https://claude.com/claude-code).
Marsh operates a Linear workspace as a factory floor: it triages incoming issues,
drafts plans, implements in isolated git worktrees, verifies adversarially, and
ships draft PRs — escalating to a human only when judgment genuinely requires one.

Marsh is a **plugin marketplace you fork and operate**. Everything workspace- and
repo-specific lives in `config/` (untracked in your instance); everything under
`plugins/marsh/` is portable.

## Principles

1. **Judgment goes to models, coordination goes to code.** Deterministic scripts
   and dynamic workflows route, gate, loop, and budget — agents only spend tokens
   on reasoning.
2. **Linear is the ledger.** Native status *types* + typed issue comments are the
   canonical, append-only state (see `protocol.md`). Any session can crash and a
   successor wakes from the issue itself. The local SQLite db and workbench cards
   are disposable projections.
3. **Roles are dispatch contracts, not costumes.** Every hat has scoped inputs,
   one owned artifact, a checklist, and a typed exit
   (`DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`).
4. **Human attention is an exception channel, not a pipeline stage.** Adversarial
   fresh-context review replaces approval ceremony wherever risk policy allows;
   gates scale with risk, ceremony scales with size.
5. **Anchors live outside the loop.** Hooks, verification workflows, and policy
   are not editable by the agents optimizing against them.
6. **Every pass ends by naming the next step.** No command leaves you at a dead
   end.

## Quickstart

```bash
git clone https://github.com/jhbarnett/marsh.git && cd marsh
./install.sh                 # prereqs, plugin, per-operator config, always-on board, dock app
open ~/Applications/Marsh.app
```

The installer expects your `config/registry.json` (copy the examples in
`config/`) — see `TEAM_SETUP.md` for team onboarding and the app-config
examples for GitHub/Linear identity (zero shared secrets: device-flow OAuth,
the agent acts as its operator).

Then, in a Claude Code session started from this repo:

1. `/marsh:sync` — introspects your Linear workspace (teams, status types, label
   groups), interprets the semantics with you, and writes `config/taxonomy.json`.
2. Copy `config/registry.example.json` → `config/registry.json` and fill in your
   repos (paths, base branches, verify commands). Same for `policy.example.json`
   → `policy.json` (lanes, WIP limits, risk-scaled gates).
3. `/marsh:status` — read-only factory floor report.
4. `/marsh:triage` — dry-run intake sweep: classification proposals land in a
   digest for your review; nothing writes to Linear until you approve.
5. `/marsh:serve` — local kanban console over `workbench/cards/` (each card is a
   markdown file; you edit only the "Your reply" zone — dictation-friendly).

## Layout

| Path | What |
|---|---|
| `DESIGN.md` | Full architecture: components, lanes, gates, build phases |
| `protocol.md` | The Linear comment-ledger protocol |
| `plugins/marsh/` | The plugin: commands, workflows, scripts (portable) |
| `config/` | Your instance bindings — examples tracked, real configs untracked |
| `workbench/` | Console: card format spec; `cards/` is your local kanban |
| `runbooks/` | Captured operational procedures for your services |

## Status

Early. Read-only console, workspace sync, and dry-run triage are functional; the
build/verify/egress stations and scheduled shifts are being extracted from the
first operating instance phase by phase (see `DESIGN.md` § Build sequence).

## License

MIT
