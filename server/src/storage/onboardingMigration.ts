import type Database from "better-sqlite3";

export const onboardingMigration = {
  version: 86,
  name: "task_first_onboarding",
  up(database: Database.Database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_onboarding (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        version INTEGER NOT NULL DEFAULT 0,
        selected_task TEXT,
        status TEXT NOT NULL DEFAULT 'not_started',
        step TEXT NOT NULL DEFAULT 'choose_task',
        dismissed INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        completion_resource_id TEXT,
        baseline_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT,
        last_request_key TEXT,
        last_request_fingerprint TEXT
      );
      CREATE TABLE IF NOT EXISTS onboarding_event_receipts (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL,
        PRIMARY KEY (user_id, request_key)
      );
    `);
  },
};
