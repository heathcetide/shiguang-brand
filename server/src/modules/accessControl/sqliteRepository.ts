import type Database from "better-sqlite3";
import type { AccessControlRepository } from "./repository.js";
import type { StoredAccessUser } from "./types.js";

export class SqliteAccessControlRepository implements AccessControlRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }

  async user(userId: number) {
    return (this.database.prepare(`SELECT session_version AS sessionVersion,is_disabled AS isDisabled,role,
      must_change_password AS mustChangePassword FROM users WHERE id=?`).get(userId) as StoredAccessUser | undefined) || null;
  }

  ensureUserInitialState(userId: number) {
    this.database.prepare("INSERT OR IGNORE INTO user_health_profiles (user_id) VALUES (?)").run(userId);
    return Promise.resolve();
  }

  async recordFunnelEvent(eventName: string, actorHash: string) {
    this.database.prepare("INSERT INTO funnel_events (event_name,actor_hash) VALUES (?,?)").run(eventName, actorHash);
  }
}
