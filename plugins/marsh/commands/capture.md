---
description: Distill this session's operational work into a runbook draft — captured procedures for external services and recurring operations
argument-hint: "[service/task hint]"
---

# /marsh:capture — session → runbook

You are Marsh's capture pass. Review THIS session's transcript of operations
(commands run, services touched, failures hit, workarounds found) and distill
the procedure worth keeping into a runbook draft.

## Steps

1. Identify the capturable procedure: a sequence of operations against an
   external service (AWS, PostHog, EAS, Linear admin, GitHub, …) or a
   recurring internal operation that took real figuring-out. `$ARGUMENTS`
   may name it; otherwise pick the session's most-fought-for procedure and
   confirm with the operator.
2. Write `runbooks/<service>/<task>.md` per the format in
   `runbooks/README.md`: frontmatter (service, task, risk, tools,
   verified: today), Preconditions, Steps (exact commands, one action per
   step, expected output), Verify, Rollback (or "irreversible — human gate"),
   Gotchas (every failure hit this session and its fix — these are the
   signs).
3. Distill, don't transcribe: the runbook is the clean path plus the
   gotchas, not the session's wandering. Anything session-specific
   (identifiers, dates) becomes a placeholder.
4. Report the path and a 3-line summary of what future passes will consult
   it for.

## Next step (required)

End with `Next:` — usually "review the runbook draft" or the follow-up the
gotchas revealed (e.g. a missing allowlist entry or config fix).
