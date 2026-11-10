import type { Pool, PoolClient } from "pg";
import type { OnboardingCompletion, OnboardingTask } from "@dietdigidose/contracts";
import { actorHashFor } from "../../services/funnelEvents.js";
import { recordFromRow, type OnboardingEvent, type OnboardingRecord } from "./domain.js";
import { captureBaseline, findCompletion } from "./evidence.js";
import type { OnboardingRepository } from "./repository.js";

export class PostgresOnboardingRepository implements OnboardingRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  private read = async (sql: string, values: Array<string | number>) => {
    let index = 0;
    return (await this.pool.query(sql.replace(/\?/g, () => `$${++index}`), values)).rows as Array<Record<string, unknown>>;
  };
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async load(userId: number) {
    await this.pool.query("INSERT INTO user_onboarding (user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING", [userId]);
    return recordFromRow((await this.pool.query("SELECT * FROM user_onboarding WHERE user_id = $1", [userId])).rows[0]);
  }
  captureBaseline(userId: number, task: OnboardingTask) { return captureBaseline(this.read, userId, task); }
  findCompletion(userId: number, current: OnboardingRecord, requested?: OnboardingCompletion) { return findCompletion(this.read, userId, current, requested); }
  async save(userId: number, expectedVersion: number, next: OnboardingRecord, event: OnboardingEvent | null) {
    return this.transaction(async client => {
      const state = next.state;
      const result = await client.query(`UPDATE user_onboarding SET version=$1,selected_task=$2,status=$3,step=$4,dismissed=$5,started_at=$6,completed_at=$7,completion_resource_id=$8,baseline_json=$9,updated_at=$10,last_request_key=$11,last_request_fingerprint=$12 WHERE user_id=$13 AND version=$14`,
        [state.version, state.selectedTask, state.status, state.step, Number(state.dismissed), state.startedAt, state.completedAt, state.completion?.resourceId ?? null, JSON.stringify(next.baseline), state.updatedAt, next.lastRequestKey, next.lastRequestFingerprint, userId, expectedVersion]);
      const changed = result.rowCount === 1;
      if (changed && event) await client.query("INSERT INTO funnel_events(event_name,actor_hash) VALUES ($1,$2)", [event, actorHashFor(userId)]);
      return changed;
    });
  }
  async saveFailed(userId: number, requestKey: string) {
    await this.transaction(async client => {
      const result = await client.query("INSERT INTO onboarding_event_receipts(user_id,request_key) VALUES ($1,$2) ON CONFLICT(user_id,request_key) DO NOTHING", [userId, requestKey]);
      if (result.rowCount) await client.query("INSERT INTO funnel_events(event_name,actor_hash) VALUES ('onboarding_save_failed',$1)", [actorHashFor(userId)]);
    });
  }
}
