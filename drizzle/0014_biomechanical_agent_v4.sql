-- Migration: 0014_biomechanical_agent_v4.sql
-- Target: Cloudflare D1 (SQLite 3, export-safe without FTS5 virtual table lock)

CREATE TABLE IF NOT EXISTS exercise_canonical_cache (
  canonical_slug     TEXT PRIMARY KEY,
  display_name_ru    TEXT NOT NULL,
  display_name_en    TEXT NOT NULL,
  input_hash         TEXT NOT NULL UNIQUE,
  descriptor_json    TEXT NOT NULL,
  solved_json        TEXT NOT NULL,
  solver_version     TEXT NOT NULL DEFAULT '4.0.0',
  source             TEXT NOT NULL CHECK (source IN ('seed_v3','llm_v4','vlm_v4','hitl_promoted')),
  model_used         TEXT,
  confidence         REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('valid','auto_corrected')),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('pending_review','active','canonical','deprecated')),
  hit_count          INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ecc_status_hits
  ON exercise_canonical_cache(status, hit_count DESC);
CREATE INDEX IF NOT EXISTS idx_ecc_solver_ver
  ON exercise_canonical_cache(solver_version);

CREATE TABLE IF NOT EXISTS exercise_aliases (
  alias_normalized   TEXT PRIMARY KEY,
  canonical_slug     TEXT NOT NULL REFERENCES exercise_canonical_cache(canonical_slug) ON DELETE CASCADE,
  locale             TEXT NOT NULL CHECK (locale IN ('ru','en','mixed')),
  brand_hint         TEXT,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aliases_slug
  ON exercise_aliases(canonical_slug);

CREATE TABLE IF NOT EXISTS exercise_user_overrides (
  user_id            TEXT NOT NULL,
  canonical_slug     TEXT NOT NULL REFERENCES exercise_canonical_cache(canonical_slug) ON DELETE CASCADE,
  execution_json     TEXT,
  descriptor_patch   TEXT,
  manual_muscle_json TEXT,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, canonical_slug)
);

CREATE TABLE IF NOT EXISTS exercise_hitl_queue (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_slug     TEXT NOT NULL REFERENCES exercise_canonical_cache(canonical_slug) ON DELETE CASCADE,
  reason             TEXT NOT NULL CHECK (reason IN ('user_consensus','verifier_auto_correct','low_confidence','vlm_new_machine')),
  proposed_desc_json TEXT NOT NULL,
  consensus_count    INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','ready_for_review','approved','rejected')),
  reviewer_id        TEXT,
  reviewed_at        INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hitl_status_consensus
  ON exercise_hitl_queue(status, consensus_count DESC);

CREATE TABLE IF NOT EXISTS agent_telemetry_logs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id         TEXT NOT NULL UNIQUE,
  user_id            TEXT NOT NULL,
  source             TEXT NOT NULL,
  model_used         TEXT,
  input_tokens       INTEGER DEFAULT 0,
  cached_tokens      INTEGER DEFAULT 0,
  output_tokens      INTEGER DEFAULT 0,
  latency_ms         INTEGER NOT NULL,
  verifier_status    TEXT NOT NULL,
  violations_json    TEXT,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_created
  ON agent_telemetry_logs(created_at DESC);
