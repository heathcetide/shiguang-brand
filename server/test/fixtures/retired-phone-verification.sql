-- Test/rehearsal only: empty pre-retirement schema, never restore retired proofs.
-- Mirrors historical migrations 35 and 85 so synthetic downgrade fixtures can reapply 91.
CREATE TABLE auth_verification_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
  channel TEXT NOT NULL CHECK(channel IN ('sms', 'captcha', 'phone')),
  provider TEXT NOT NULL, subject_hmac TEXT NOT NULL,
  subject_ciphertext TEXT NOT NULL, subject_iv TEXT NOT NULL,
  subject_auth_tag TEXT NOT NULL, last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, provider, subject_hmac),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE auth_verification_challenges (
  id TEXT PRIMARY KEY, subject_id INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT 'login',
  out_id TEXT NOT NULL UNIQUE, biz_id TEXT, provider_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
  registration_token_hash TEXT, registration_expires_at DATETIME, expires_at DATETIME NOT NULL,
  verified_at DATETIME, consumed_at DATETIME, source_ip TEXT, user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reauth_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reauth_session_version INTEGER,
  FOREIGN KEY (subject_id) REFERENCES auth_verification_subjects(id) ON DELETE CASCADE
);
CREATE TABLE auth_verification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, challenge_id TEXT,
  channel TEXT NOT NULL, provider TEXT NOT NULL, event_type TEXT NOT NULL, outcome TEXT NOT NULL,
  provider_code TEXT, provider_message TEXT, provider_request_id TEXT, biz_id TEXT, out_id TEXT,
  source_ip TEXT, user_agent TEXT, details_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subject_id) REFERENCES auth_verification_subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (challenge_id) REFERENCES auth_verification_challenges(id) ON DELETE CASCADE
);
CREATE TABLE auth_verification_usage_daily (
  usage_date TEXT NOT NULL, channel TEXT NOT NULL, provider TEXT NOT NULL,
  send_requests INTEGER NOT NULL DEFAULT 0, send_api_calls INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0,
  delivery_failed INTEGER NOT NULL DEFAULT 0, verify_api_calls INTEGER NOT NULL DEFAULT 0,
  verify_passed INTEGER NOT NULL DEFAULT 0, verify_failed INTEGER NOT NULL DEFAULT 0,
  local_rate_limited INTEGER NOT NULL DEFAULT 0, provider_errors INTEGER NOT NULL DEFAULT 0,
  delivery_units INTEGER NOT NULL DEFAULT 0, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usage_date, channel, provider)
);
CREATE INDEX idx_auth_subjects_user ON auth_verification_subjects(user_id, channel);
CREATE INDEX idx_auth_challenges_subject_created ON auth_verification_challenges(subject_id, created_at DESC);
CREATE INDEX idx_auth_challenges_biz_out ON auth_verification_challenges(biz_id, out_id);
CREATE UNIQUE INDEX idx_auth_challenges_registration_token ON auth_verification_challenges(registration_token_hash) WHERE registration_token_hash IS NOT NULL;
CREATE INDEX idx_auth_events_subject_created ON auth_verification_events(subject_id, created_at DESC);
CREATE INDEX idx_auth_events_ip_created ON auth_verification_events(source_ip, created_at DESC);
CREATE INDEX idx_auth_events_provider_ids ON auth_verification_events(biz_id, out_id, provider_request_id);
CREATE TABLE account_reauth_grants (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('password_update','account_delete')), phone TEXT NOT NULL,
  session_version INTEGER NOT NULL, expires_at DATETIME NOT NULL, consumed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_account_reauth_user ON account_reauth_grants(user_id, expires_at);
