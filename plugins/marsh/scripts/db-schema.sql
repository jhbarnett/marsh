-- Marsh working memory (var/marsh.db)
-- DISPOSABLE: Linear + git are canonical. Deleting this db loses nothing that
-- matters; Marsh rebuilds it from the ledger. Never store anything here that a
-- successor session could not re-derive.

CREATE TABLE IF NOT EXISTS parked_tasks (
  issue_id      TEXT PRIMARY KEY,       -- e.g. ENG-123
  lane          TEXT NOT NULL,          -- dev | planning | discovery | gardening
  reason        TEXT NOT NULL,          -- elicitation | needs_context | external_wait
  wake_kind     TEXT NOT NULL,          -- comment_reply | pr_merged | timer | manual
  wake_ref      TEXT,                   -- comment id, PR url, or ISO timestamp
  parked_at     TEXT NOT NULL,          -- ISO timestamp
  payload       TEXT                    -- JSON: resume brief (paths, branch, next step)
);

CREATE TABLE IF NOT EXISTS shift_log (
  shift_id      TEXT PRIMARY KEY,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  mode          TEXT NOT NULL,          -- scheduled | interactive
  tokens_spent  INTEGER,
  digest_path   TEXT
);

CREATE TABLE IF NOT EXISTS station_passes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id      TEXT REFERENCES shift_log(shift_id),
  issue_id      TEXT NOT NULL,
  station       TEXT NOT NULL,          -- triage | plan | build | verify | egress | discovery | witness
  role          TEXT,                   -- hat worn, if any
  attempt       INTEGER NOT NULL DEFAULT 1,
  exit_status   TEXT NOT NULL,          -- DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | PROPOSED
  escalated     INTEGER NOT NULL DEFAULT 0,
  tokens_spent  INTEGER,
  notes         TEXT                    -- short failure/discovery note; weakness-mining input
);

CREATE TABLE IF NOT EXISTS briefs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,          -- issue id, repo, or topic
  wave          INTEGER,
  created_at    TEXT NOT NULL,
  brief         TEXT NOT NULL           -- <=500-token compressed discovery, relayed between waves
);

CREATE TABLE IF NOT EXISTS dedupe_cache (
  fingerprint   TEXT PRIMARY KEY,       -- normalized title/content hash
  issue_id      TEXT NOT NULL,
  seen_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passes_issue ON station_passes(issue_id);
CREATE INDEX IF NOT EXISTS idx_passes_status ON station_passes(exit_status);
CREATE INDEX IF NOT EXISTS idx_briefs_scope ON briefs(scope);
