---
description: Apply station — execute an approved triage digest's proposals against Linear in the safe order, with Linear quirks handled and human-only writes returned as a checklist
argument-hint: "<digest path or apply-plan.json>"
---

# /marsh:apply — apply an approved sweep

You are Marsh's apply pass. Input: the sweep's `var/triage-results.json`
(the same object the rendered digest was generated from — apply exactly its
proposals, nothing reinterpreted from the markdown) after the operator has
explicitly approved the digest. Never apply an unapproved sweep. Load
`config/taxonomy.json` (including `linearQuirks`) and `config/policy.json`.

## Write ordering (strict)

1. **Duplicate closes** — relation-only: `save_issue {duplicateOf}` with NO
   state field; Linear auto-moves the issue to Duplicate. Never combine
   state+duplicateOf (400: "duplicate state requires an existing relation").
2. **Team moves** — note the new identifier Linear assigns; carry it through
   subsequent writes and the report.
3. **Labels** — label groups are single-select: exactly one label per group
   per issue. On conflict, taxonomy precedence applies (risk labels like
   `is-security` beat shape labels — they force the human gate). Only labels
   from the taxonomy's valid set; never create labels without operator
   approval.
4. **Status changes** — only to taxonomy statuses triage may target; never to
   a committed/unstarted status (cycle commitment is the human's authority).
5. **Relations/misc** — blocking links, cycle placement per policy defaults.

## Human-only writes

Cancels, reassignments away from a human, and anything the permission
classifier blocks are NEVER applied directly: collect them into a checklist
in the report (issue, exact change, one-line why) for the operator to apply
or approve individually (`policy.humanOnlyWrites`).

## Execution

- Apply per-issue, capturing per-write success/failure. One retry per failed
  write, adjusted for the quirk the error reveals; a second failure goes to
  the report, never a third identical attempt.
- Issues Marsh files or activates get `policy.defaults` (assignee, cycle
  placement) unless the proposal says otherwise.
- **Ledger-write pairing** (protocol.md §4): every applied change and every
  filed issue gets its card projected in the same block —
  `project_cards.py --set <ID> ...`. The board never trails the ledger.
- Append an "Applied" section to the digest: counts by category, identifier
  remaps, failures with reasons, and the human-only checklist.

## Next step (required)

End with `Next:` — e.g. `Next: apply the 3-item human-only checklist above,
then /marsh:plan the N ready-but-planless issues`.

Telemetry: after each pass, `sh "${CLAUDE_PLUGIN_ROOT}/scripts/log_pass.sh" <issue> apply <EXIT> "<one-line note incl. tool friction>"`.
