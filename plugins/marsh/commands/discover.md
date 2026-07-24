---
description: Discovery station — mine PostHog, app sessions, and market research for evidenced product gaps; high-confidence gaps become Triage issues, weaker signals accumulate in a report
argument-hint: "[--sources posthog,web] [--dry-run]"
---

# /marsh:discover — discovery station

You are Marsh's discovery pass (discovery lane — writes issues to Linear,
never code). Run from the hub. Load `config/taxonomy.json` and
`config/policy.json`; re-read `protocol.md` before posting.

## Steps

1. **Prepare sources** (default: posthog + web; `--sources` restricts). Build
   the workflow payload with one entry per source:
   - `posthog`: instructions to sweep error-tracking issues, rage-click /
     session-replay signals, and funnel drop-offs via the PostHog MCP tools —
     each candidate cites replay links / issue IDs / counts.
   - `web`: market research on competitor capabilities for the product's
     domains — each candidate cites URLs.
   - `interviews` (when a transcripts path is configured/provided): quote
     verbatims with file references.
2. **Dedupe context**: open-issue titles per team (batched fetch → briefs,
   `build_briefs.py`), plus `dedupe_cache` fingerprints from `var/marsh.db`.
3. **Run the workflow**: `scriptPath: ${CLAUDE_PLUGIN_ROOT}/workflows/discovery-sweep.js`
   with `{sources, openTitles, domains}`.
4. **Threshold the output** (per the discovery-output decision):
   - `high` confidence + checkable evidence → file as a Triage issue in the
     owning team: `is-gap` label, `policy.defaults` assignee, evidence in the
     description, a `marsh:discovery` ledger comment (v2), card projection in
     the same block (ledger-write pairing). Record a fingerprint in
     `dedupe_cache`.
   - `medium`/`low` → append to `reports/discovery-YYYY-MM-DD.md` with
     evidence — signals accumulate across sweeps until they clear the bar.
   - `--dry-run`: everything goes to the report, no Linear writes.
5. **Report**: N filed (identifiers), M accumulated, dropped-with-reasons,
   report path.

## Rules

- Never file without evidence a skeptical PM couldn't dismiss ("show me").
- Issue titles carry no bare issue identifiers of other issues.
- Cancels/merges of existing issues are never done here — note suspected
  duplicates in the report for triage to handle.

## Next step (required)

End with `Next:` — e.g. `Next: triage the 2 filed gaps (they enter the normal
intake funnel)`, or `Next: review discovery report — 3 medium signals near
the bar`.

Telemetry: after each pass, `sh "${CLAUDE_PLUGIN_ROOT}/scripts/log_pass.sh" discovery discovery <EXIT> "<note>"`.
