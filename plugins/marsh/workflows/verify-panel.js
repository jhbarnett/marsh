export const meta = {
  name: 'marsh-verify-panel',
  description: 'Adversarial diff review for Marsh-built changes: parallel lens reviewers, then per-finding validators; unvalidated findings dropped',
  whenToUse: 'Dispatched by /marsh:build after the verify gate passes, before (or immediately after) the draft PR. args: {repo, worktree, baseBranch, branch, issueId, planContract, lenses?}',
  phases: [
    { title: 'Review', detail: 'one reviewer per lens over the diff' },
    { title: 'Validate', detail: 'fresh-context validator per finding; unvalidated dropped' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'severity', 'claim', 'evidence'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['BLOCKER', 'MAJOR', 'MINOR'] },
          claim: { type: 'string', maxLength: 300 },
          evidence: { type: 'string', maxLength: 400, description: 'what the code shows, file:line' },
          suggestedFix: { type: 'string', maxLength: 300 },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'reason', 'severity'],
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'REJECTED'] },
    reason: { type: 'string', maxLength: 300 },
    severity: { type: 'string', enum: ['BLOCKER', 'MAJOR', 'MINOR'], description: 're-derived from the plan contract and risk policy — do NOT inherit the reviewer score' },
  },
}

const repo = args?.repo
const worktree = args?.worktree
const base = args?.baseBranch ?? 'main'
const branch = args?.branch
const plan = args?.planContract ?? '(no plan contract provided)'
const lenses = args?.lenses ?? [
  { key: 'correctness', focus: 'logic errors, broken edge cases, wrong behavior vs the plan acceptance criteria' },
  { key: 'silent-failures', focus: 'swallowed errors, empty catches, fallbacks that hide failure, missing error propagation' },
  { key: 'test-adequacy', focus: 'do the added/changed tests actually enforce the acceptance criteria; weakened or missing assertions; untested new paths' },
  { key: 'conventions', focus: 'violations of the repo AGENTS.md/CLAUDE.md conventions and existing patterns in the touched modules' },
]

const context = [
  `Repo: ${repo}. Review worktree: ${worktree} (branch ${branch}, base origin/${base}).`,
  `Get the diff yourself: \`git -C ${worktree} diff origin/${base}...HEAD\` (and read surrounding code as needed — READ-ONLY, modify nothing).`,
  `Plan contract (what "done" means):\n${plan}`,
].join('\n')

phase('Review')
const reviewed = await pipeline(
  lenses,
  (lens) =>
    agent(
      [
        `You are one lens of an adversarial review panel for issue ${args?.issueId}. Lens: ${lens.key} — ${lens.focus}.`,
        context,
        `Report ONLY findings visible in this diff (not pre-existing issues), high-signal only: a finding must name a concrete defect with file:line evidence.`,
        `Quality tier rule: report HIGH VALUE only — a defect a reviewer would act on. LOW VALUE observations (style, hypotheticals without a trigger, anything on the plan's out-of-scope list) are noted mentally and dropped; keep looking instead.`,
        `No findings is a valid result — do not manufacture nitpicks.`,
      ].join('\n\n'),
      { label: `review:${lens.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }
    ),
  (result, lens) =>
    parallel(
      (result?.findings ?? []).map((f) => () =>
        agent(
          [
            `Adversarially validate ONE code-review finding. You see only the finding and the code — not the reviewer's reasoning. Default to REJECTED unless the code confirms it.`,
            context,
            `Finding (lens ${lens.key}): [${f.severity}] ${f.file}:${f.line} — ${f.claim}`,
            `Claimed evidence: ${f.evidence}`,
            `Verify in the actual worktree code (READ-ONLY). CONFIRMED only if the defect is real, in this diff, and matters.`,
            `If CONFIRMED, re-derive severity yourself from the plan contract's acceptance criteria and blast radius — ignore the reviewer's score (overconfidence check).`,
          ].join('\n\n'),
          { label: `validate:${f.file}:${f.line}`, phase: 'Validate', schema: VERDICT_SCHEMA }
        ).then((v) => ({ ...f, severity: v?.severity ?? f.severity, lens: lens.key, verdict: v }))
      )
    )
)

const confirmed = reviewed
  .filter(Boolean)
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict?.verdict === 'CONFIRMED')

return {
  confirmed,
  counts: {
    lenses: lenses.length,
    confirmed: confirmed.length,
    blockers: confirmed.filter((f) => f.severity === 'BLOCKER').length,
  },
}
