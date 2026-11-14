-- Agent runtime + plan-maintenance apply flags for Go-native Express API parity.

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'proposed',
  payload_json TEXT NOT NULL DEFAULT '{}',
  before_json TEXT,
  result_json TEXT,
  idempotency_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  executed_at TEXT,
  undone_at TEXT,
  approval_decision TEXT,
  approved_by_user_id INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_run ON agent_actions(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_user ON agent_actions(user_id, status);

CREATE TABLE IF NOT EXISTS agent_run_media (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  data_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_run_media_run ON agent_run_media(run_id);

CREATE TABLE IF NOT EXISTS realtime_voice_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  recipe_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  client_platform TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_realtime_voice_sessions_user ON realtime_voice_sessions(user_id);

CREATE TABLE IF NOT EXISTS realtime_voice_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, sequence)
);

CREATE TABLE IF NOT EXISTS realtime_voice_transcript_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  transcript TEXT NOT NULL DEFAULT '',
  is_final INTEGER NOT NULL DEFAULT 0,
  audio_bytes INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, turn_id, sequence)
);
