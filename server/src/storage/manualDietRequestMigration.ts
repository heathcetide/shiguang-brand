import type Database from "better-sqlite3";

export const manualDietRequestMigration = {
  version:87,
  name:"manual_diet_record_request_receipts",
  up(database:Database.Database) {
    database.exec(`CREATE TABLE IF NOT EXISTS diet_record_create_requests (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      diet_record_id INTEGER REFERENCES diet_records(id) ON DELETE SET NULL,
      result_json TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,request_key)
    ); CREATE INDEX IF NOT EXISTS idx_diet_create_record ON diet_record_create_requests(diet_record_id);`);
  },
};
