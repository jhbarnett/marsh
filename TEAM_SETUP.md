# Team setup — running Marsh on your machine

This repo is your team's **private Marsh instance**: shared contracts, configs,
taxonomy, runbooks, and evals for operating our Linear workspace. Each operator
runs their **own** Marsh locally — same repos and teams, your own auth, your
own tasks. Per-operator state (workbench cards, `var/`, `config/operator.json`)
never syncs.

## Prerequisites

- Claude Code (latest) with the **Linear MCP** connected under *your* account —
  Marsh's Linear writes act as you, and `assignee: "me"` resolves to you.
- `node` ≥ 20, `tmux`, `ttyd` (`brew install tmux ttyd`), `python3`, `gh` (authed).
- Checkouts of the target repos (`fitrankings-core`, `fitrankings-apps`, …)
  under one workspace root, using the same directory names as the registry.

## Setup

```bash
git clone https://github.com/YOUR-ORG/YOUR-marsh-instance.git && cd marsh-agent
claude plugin marketplace add "$(pwd)"
claude plugin install marsh@marsh
```

If your workspace root isn't the reference operator's, create
`config/operator.json` (gitignored):

```json
{ "workspaceRoot": "/path/to/your/code" }
```

Repo paths resolve as `<your workspaceRoot>/<same repo dirname>`.

## First run

1. `plugins/marsh/scripts/marsh-up.sh` — theme sync (Ghostty supported),
   tmux session running `claude`, themed web terminal, the board, browser.
2. In the session: `/marsh:status` (read-only orientation), then work as the
   contracts describe — start with `DESIGN.md` §1 (principles) and
   `protocol.md` (the ledger). `/marsh:shift --dry-run` shows what the
   dispatcher would do without doing it.
3. Install the dashboard to your dock: Chrome → Install page as app.

## Multi-operator rules (the short version)

- **An assignment is a claim.** Your Marsh only pulls issues that are yours or
  unassigned; a teammate's assignment is their lane. Taking over anything
  assigned to a human goes through the takeover elicitation (protocol §5).
- **Contracts are shared; pull before sessions.** The freshness hook tells a
  running session when protocol/commands/config changed under it.
- **Config changes are PRs** like any code — `config/`, `plugins/marsh/hooks/`,
  and `protocol.md` are the factory's anchors; treat amendments accordingly.
  Improvements graduate upstream to the public base
  (github.com/jhbarnett/marsh) via `scripts/publish-base.sh` (see
  `PUBLISHING.md`).
- Human gates are **per operator**: your approvals live on your issues' cards
  and ledger comments; nothing you approve unlocks anyone else's risk gates.
