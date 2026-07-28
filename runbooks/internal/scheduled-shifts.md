---
service: internal
task: scheduled-shifts
risk: infra
tools: [Bash, launchctl]
verified: null
---

# Enable scheduled unattended shifts

Not enabled until the operator flips it — unattended token spend is an
explicit opt-in. Prereqs before first schedule:

## Preconditions (calibration gate)

1. One supervised live shift has dispatched a **dev-lane build** end-to-end
   (planning-lane-only validation is not sufficient).
2. Permission allowlist passes: run a recent transcript scan
   (`/fewer-permission-prompts`) and confirm a dry-run
   `claude -p "/marsh:shift --dry-run"` completes with **zero permission
   prompts** (a prompt at 2 a.m. strands the run).
3. `config/policy.json` budgets reviewed (`perShiftTokens` is the ceiling
   the dispatcher honors).

## Steps

1. Copy the template, filling in the hub path:
   `cp scripts/com.marsh.shift.plist.template ~/Library/LaunchAgents/com.marsh.shift.plist`
   then edit `MARSH_HUB` and the schedule (defaults: 06:30 and 12:30 local).
2. `launchctl load ~/Library/LaunchAgents/com.marsh.shift.plist`
3. First scheduled run: review `reports/shift-*.md` and `var/shift.log` the
   morning after before trusting it.

## Verify

- `launchctl list | grep com.marsh.shift` shows the job.
- After a scheduled fire: a new digest in `reports/`, cards projected,
  `station_passes` rows present.

## Rollback

`launchctl unload ~/Library/LaunchAgents/com.marsh.shift.plist && rm` the
plist. Nothing else to undo — shifts are stateless passes.

## Gotchas

- launchd runs without your shell env: the plist must carry PATH (homebrew)
  and MARSH_HUB explicitly.
- The shift opens no windows (`MARSH_NO_OPEN=1`); it is digest-only.
- BLOCKED escalations during unattended runs surface in the digest and the
  board — check `awaiting-decision` first thing after each scheduled shift.
