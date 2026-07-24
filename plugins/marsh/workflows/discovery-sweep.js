export const meta = {
  name: 'marsh-discovery-sweep',
  description: 'Product-gap discovery: parallel evidence gathering per source, then synthesis with dedupe and evidence grading',
  whenToUse: 'Dispatched by /marsh:discover. args: {sources:[{key,instructions}], openTitles:{team:[..]}, domains:[..]}',
  phases: [
    { title: 'Gather', detail: 'one agent per evidence source' },
    { title: 'Synthesize', detail: 'dedupe, grade evidence, keep the fundable gaps' },
  ],
}

const CANDIDATES_SCHEMA = {
  type: 'object',
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'evidence', 'confidence', 'domains'],
        properties: {
          title: { type: 'string', maxLength: 120 },
          summary: { type: 'string', maxLength: 400 },
          evidence: { type: 'array', items: { type: 'string', maxLength: 300 }, description: 'links, quotes, counts — concrete and checkable' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          domains: { type: 'array', items: { type: 'string' } },
          suggestedShape: { type: 'string' },
        },
      },
    },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  required: ['proposals', 'dropped'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'summary', 'evidence', 'confidence', 'domains', 'team'],
        properties: {
          title: { type: 'string' }, summary: { type: 'string', maxLength: 600 },
          evidence: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          domains: { type: 'array', items: { type: 'string' } },
          team: { type: 'string' },
          suspectedExisting: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    dropped: { type: 'array', items: { type: 'string' }, description: 'candidate titles dropped and why (dup / evidence too thin)' },
  },
}

const sources = args?.sources ?? []
if (!sources.length) return { proposals: [], dropped: [], note: 'no sources configured' }
const openTitles = JSON.stringify(args?.openTitles ?? {})
const domains = (args?.domains ?? []).join(', ')

phase('Gather')
const gathered = (
  await parallel(sources.map((s) => () =>
    agent(
      [
        `You are one evidence source for Marsh's product-gap discovery sweep. Source: ${s.key}.`,
        s.instructions,
        `Rules: evidence must be concrete and checkable (links, verbatim quotes, counts) — no vibes. Candidate domains: ${domains}.`,
        `Blind sweep: do not assume other sources; report what YOUR source shows, even if weak (mark confidence honestly).`,
      ].join('\n\n'),
      { label: `gather:${s.key}`, phase: 'Gather', schema: CANDIDATES_SCHEMA }
    )
  ))
).filter(Boolean)

phase('Synthesize')
const synthesis = await agent(
  [
    `Synthesize product-gap candidates from ${gathered.length} evidence sources into fundable proposals.`,
    `Candidates:\n${JSON.stringify(gathered, null, 1)}`,
    `Existing open issues (dedupe against these — match meaning, not wording):\n${openTitles}`,
    `Merge candidates describing the same gap (evidence accumulates; confidence rises with corroboration).`,
    `Drop: duplicates of existing issues (list under dropped with the existing identifier), and anything whose evidence would not survive a skeptical PM asking "show me".`,
    `Assign each proposal the owning team by domain.`,
  ].join('\n\n'),
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA }
)

return { ...synthesis, sourcesRun: sources.map((s) => s.key) }
