import type Database from "better-sqlite3";

export const passwordlessMigration = {
  version: 85,
  name: "passwordless_accounts_and_scoped_reauthentication",
  rebuildsReferencedTable: true,
  up(database: Database.Database) {
    const columns = database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string; notnull: number }>;
    if (columns.find((column) => column.name === "password_hash")?.notnull) {
      const sequence = database.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()
        ? database.prepare("SELECT seq FROM sqlite_sequence WHERE name='users'").get() as {seq:number} | undefined : undefined;
      const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string };
      const dependents = database.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
      const definition = schema.sql.replace(/CREATE TABLE(?: IF NOT EXISTS)?\s+["`\[]?users["`\]]?/i, 'CREATE TABLE users_passwordless_new')
        .replace(/(password_hash["`\]]?\s+TEXT)\s+NOT NULL/i, "$1");
      database.exec(definition);
      const names = columns.map((column) => `"${column.name.replace(/"/g, '""')}"`).join(",");
      database.exec(`INSERT INTO users_passwordless_new (${names}) SELECT ${names} FROM users; DROP TABLE users; ALTER TABLE users_passwordless_new RENAME TO users;`);
      for (const dependent of dependents) database.exec(dependent.sql);
      if (sequence) {
        const updated = database.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='users'").run(sequence.seq);
        if (!updated.changes) database.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('users',?)").run(sequence.seq);
      }
    }
    const challengeColumns = database.prepare("PRAGMA table_info(auth_verification_challenges)").all() as Array<{ name: string }>;
    if (!challengeColumns.some((column) => column.name === "reauth_user_id")) database.exec("ALTER TABLE auth_verification_challenges ADD COLUMN reauth_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
    if (!challengeColumns.some((column) => column.name === "reauth_session_version")) database.exec("ALTER TABLE auth_verification_challenges ADD COLUMN reauth_session_version INTEGER");
    database.exec(`CREATE TABLE IF NOT EXISTS account_reauth_grants (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK(purpose IN ('password_update','account_delete')), phone TEXT NOT NULL,
      session_version INTEGER NOT NULL, expires_at DATETIME NOT NULL, consumed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ); CREATE INDEX IF NOT EXISTS idx_account_reauth_user ON account_reauth_grants(user_id, expires_at);`);
  },
};
