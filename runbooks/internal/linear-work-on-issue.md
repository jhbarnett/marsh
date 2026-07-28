---
service: linear
task: work-on-issue-bridge
risk: low
tools: [claude, bash]
verified: null
---

# Linear "Work on issue" → Marsh station

Event-driven dispatch with zero hosting: click **Work on issue → Marsh** on
any Linear issue (desktop app) and a terminal opens running the right Marsh
station for it — plan if unplanned, build if approved+committed. Gates are
untouched: the click is dispatch, not approval.

## Recommended: Custom link (one visible button, opens via the board)

Linear Settings → the **Custom link** coding tool → enable and set:

```
http://localhost:4643/work?prompt={{prompt}}
```

Clicking it on any issue opens a Marsh confirm page (shows exactly what will
dispatch — this is also the CSRF gate), and **Dispatch** spawns the detached
`marsh-<ID>` station session; the page returns to the board. Requires the
board service running (it always is — launchd).

## Alternate: Custom script (terminal-attached session)

Same dispatch, but Linear opens a terminal attached to the session — use
when you want to watch the station live from the click.

### Setup (per operator, once)

1. Ensure `~/.config/marsh/hub` exists (install.sh writes it).
2. Add to `~/.linear/coding-tools.json`:

```json
{
  "tools": [
    {
      "name": "Marsh",
      "command": "<HUB>/plugins/marsh/scripts/work-on-issue.sh"
    }
  ]
}
```

(replace `<HUB>` with your marsh-agent clone path; Linear injects
`LINEAR_ISSUE_IDENTIFIER` and friends at run time)

3. Restart the Linear desktop app; **Work on issue** now offers *Marsh*.

## Verify

Click it on a Backlog issue → terminal opens attached to a `marsh-<ID>`
session running `/marsh:plan <ID>`; the session survives closing the window
(`claude agents` lists it).

## Gotchas

- Linear passes no cwd/repo signal and no login-shell PATH — the script
  handles both (hub from `~/.config/marsh/hub`; PATH prepended).
- `LINEAR_CLAUDE_PROMPT` env in coding-tools.json overrides the routing
  prompt per tool entry if you want a variant (e.g. straight-to-plan).
- Predecessor (repo-map + /implement version): `agent-ops/services/linear` —
  superseded by hub-registry resolution; the map file is gone by design.
