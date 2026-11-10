import type Database from "better-sqlite3";
import type { OnboardingCompletion, OnboardingTask } from "@dietdigidose/contracts";
import { actorHashFor } from "../../services/funnelEvents.js";
import { recordFromRow, type OnboardingEvent, type OnboardingRecord } from "./domain.js";
import { captureBaseline, findCompletion } from "./evidence.js";
import type { OnboardingRepository } from "./repository.js";

export class SqliteOnboardingRepository implements OnboardingRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }
  private read = async (sql: string, values: Array<string | number>) => this.database.prepare(sql).all(...values) as Array<Record<string, unknown>>;
  async load(userId: number) {
    this.database.prepare("INSERT INTO user_onboarding (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING").run(userId);
    return recordFromRow(this.database.prepare("SELECT * FROM user_onboarding WHERE user_id = ?").get(userId) as Record<string, unknown>);
  }
  captureBaseline(userId: number, task: OnboardingTask) { return captureBaseline(this.read, userId, task); }
  findCompletion(userId: number, current: OnboardingRecord, requested?: OnboardingCompletion) { return findCompletion(this.read, userId, current, requested); }
  async save(userId: number, expectedVersion: number, next: OnboardingRecord, event: OnboardingEvent | null) {
    return this.database.transaction(() => {
      const state = next.state;
      const changed = this.database.prepare(`UPDATE user_onboarding SET version=?,selected_task=?,status=?,step=?,dismissed=?,started_at=?,completed_at=?,completion_resource_id=?,baseline_json=?,updated_at=?,last_request_key=?,last_request_fingerprint=? WHERE user_id=? AND version=?`)
        .run(state.version, state.selectedTask, state.status, state.step, Number(state.dismissed), state.startedAt, state.completedAt, state.completion?.resourceId ?? null, JSON.stringify(next.baseline), state.updatedAt, next.lastRequestKey, next.lastRequestFingerprint, userId, expectedVersion).changes === 1;
      if (changed && event) this.database.prepare("INSERT INTO funnel_events (event_name,actor_hash) VALUES (?,?)").run(event, actorHashFor(userId));
      return changed;
    })();
  }
  async saveFailed(userId: number, requestKey: string) {
    this.database.transaction(() => {
      const result = this.database.prepare("INSERT INTO onboarding_event_receipts(user_id,request_key) VALUES (?,?) ON CONFLICT(user_id,request_key) DO NOTHING").run(userId, requestKey);
      if (result.changes) this.database.prepare("INSERT INTO funnel_events (event_name,actor_hash) VALUES ('onboarding_save_failed',?)").run(actorHashFor(userId));
    })();
  }
}
