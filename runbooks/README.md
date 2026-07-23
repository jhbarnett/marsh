# Runbooks

Captured operational procedures — the factory's institutional memory for working
with external services (AWS, PostHog, EAS, Mailgun, Linear admin, …) and for
recurring internal operations (release steps, cache resets, seed data).

**Stations must consult matching runbooks before improvising** against any
external service. If no runbook exists and the procedure took real figuring-out,
capturing one is part of finishing the task.

## How runbooks are created

1. `/marsh capture` — distills the operations performed in the current session
   into a draft runbook for review.
2. Weakness mining — repeated failure clusters in `station_passes` telemetry
   generate runbook proposals.
3. By hand.

## Layout

```
runbooks/<service>/<task>.md      e.g. runbooks/aws/rotate-ecs-secrets.md
                                       runbooks/posthog/export-replay-evidence.md
```

## Format

```markdown
---
service: aws            # aws | posthog | eas | mailgun | linear | internal | ...
task: rotate-ecs-secrets
risk: infra             # maps to policy riskClasses; infra/security => human gate
tools: [Bash, mcp__posthog]
verified: 2026-07-23    # last time this runbook was executed successfully
---

# Rotate ECS secrets

## Preconditions
- AWS creds fresh (if they fail: STOP and escalate — never work around)

## Steps
1. Exact commands, one action per step, with expected output.

## Verify
- The machine-checkable signal that the procedure worked.

## Rollback
- How to undo, or "irreversible — human gate required".

## Gotchas
- Accumulated signs: things that bit us before.
```

The `verified` date is maintenance metadata: the witness pass flags runbooks
unverified for >90 days that are still being consulted.
