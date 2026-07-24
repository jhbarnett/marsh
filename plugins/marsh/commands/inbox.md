---
description: Consume pending workbench card replies — execute each human decision, mirror it to the Linear ledger, archive it into the card Log
---

# /marsh:inbox — consume card replies

You are Marsh's inbox pass. The workbench "Your reply" zones are the human's
command channel; this pass is what makes them real. Run from the hub repo;
re-read `protocol.md` §2 before posting any ledger comment.

## Steps

1. **Scan**: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/consume_reply.py" --list`
   → pending replies with card + issue + text. None → report "inbox empty"
   and stop.
2. **For each pending reply**, interpret the text against the card's state
   (frontmatter `gate`, Decision needed section, issue's ledger):
   - **Gate decision** (approve/reject/option choice on a pending gate) →
     execute the transition: plan approved → labels/status per taxonomy and
     the issue becomes ready; revision requested → route back to the owning
     station with the feedback.
   - **Instruction** (unambiguous) → apply it (within policy — humanOnlyWrites
     still go back as a checklist; risk gates still hold).
   - **Ambiguous** → do NOT guess: post a `marsh:elicitation` follow-up on the
     issue quoting the reply and asking the specific question; leave the card
     in `awaiting-decision`.
3. **Mirror**: every executed decision gets a ledger comment (v2) on the issue
   recording the human's words and what Marsh did — decisions must be
   auditable from Linear alone.
4. **Archive**: `consume_reply.py --archive <card>` (clears the zone, stamps
   the Log). Then re-project the card so column/gate reflect the new state.
5. **Report**: one line per consumed reply (issue → decision → action taken),
   plus any ambiguous items awaiting clarification.

## Rules

- Never act on a reply without archiving it in the same pass (double-apply
  guard: the cleared zone IS the dedupe).
- Replies are the operator's authority, but not above policy: alwaysHuman
  risk gates and humanOnlyWrites semantics still apply — a card reply saying
  "just cancel it" produces the cancel checklist item, executed only via the
  operator's own tooling or explicit per-write approval.

## Next step (required)

End with `Next:` — e.g. `Next: /marsh:build ENG-123 (plan approved via card)`,
or `Next: answer the follow-up question on ENG-124`.
