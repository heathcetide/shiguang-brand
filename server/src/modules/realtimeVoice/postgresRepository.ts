import type { Pool, PoolClient } from "pg";
import type { RealtimeVoiceRepository } from "./repository.js";
import type { RealtimeVoiceSession } from "./types.js";

type Row = Record<string, unknown>;

export class PostgresRealtimeVoiceRepository implements RealtimeVoiceRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async createSession(input: { id: string; userId: number; recipeId: number; platform: string; context: Record<string, unknown>; idempotencyKey: string }) {
    return this.tx(async (client) => {
      const recipe = (await client.query("SELECT id,title FROM recipes WHERE id=$1 AND status='approved' AND deleted_at IS NULL", [input.recipeId])).rows[0];
      if (!recipe) return { status: "recipe_missing" as const };
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`realtime-session:${input.userId}:${input.idempotencyKey}`]);
      const existing = (await client.query("SELECT * FROM realtime_voice_sessions WHERE user_id=$1 AND idempotency_key=$2", [input.userId, input.idempotencyKey])).rows[0];
      if (existing) return { status: "repeated" as const, session: this.mapSession(existing) };
      const inserted = (await client.query(`INSERT INTO realtime_voice_sessions
        (id,user_id,recipe_id,client_platform,context_json,idempotency_key,expires_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,CURRENT_TIMESTAMP+INTERVAL '2 hours') RETURNING *`,
      [input.id, input.userId, recipe.id, input.platform, JSON.stringify({ recipeTitle: recipe.title, ...input.context }), input.idempotencyKey])).rows[0];
      await this.event(client, input.id, "session.ready", { transport: "event-stream", rawAudioRetained: false, vad: "client" });
      return { status: "created" as const, session: this.mapSession(inserted) };
    });
  }

  async session(sessionId: string, userId: number) {
    const row = (await this.pool.query("SELECT * FROM realtime_voice_sessions WHERE id=$1 AND user_id=$2", [sessionId, userId])).rows[0];
    return row ? this.mapSession(row) : null;
  }

  async heartbeat(sessionId: string, userId: number, version: number, status: string, reconnect: boolean) {
    const row = (await this.pool.query(`UPDATE realtime_voice_sessions SET status=$1,version=version+1,
      reconnect_count=reconnect_count+$2,last_heartbeat_at=CURRENT_TIMESTAMP
      WHERE id=$3 AND user_id=$4 AND version=$5 AND status<>'closed' RETURNING *`,
    [status, reconnect ? 1 : 0, sessionId, userId, version])).rows[0];
    return row ? this.mapSession(row) : null;
  }

  async transcript(sessionId: string, turnId: string, sequence: number) {
    const row = (await this.pool.query(`SELECT transcript,is_final AS final,latency_ms AS "latencyMs" FROM realtime_voice_transcript_chunks
      WHERE session_id=$1 AND turn_id=$2 AND sequence=$3`, [sessionId, turnId, sequence])).rows[0];
    return row ? { transcript: String(row.transcript), final: Boolean(row.final), latencyMs: Number(row.latencyMs) } : null;
  }

  async recordTranscript(input: { sessionId: string; turnId: string; userId: number; sequence: number; transcript: string;
    final: boolean; audioBytes: number; latencyMs: number; firstTranscriptMs: number }) {
    await this.tx(async (client) => {
      const inserted = await client.query(`INSERT INTO realtime_voice_transcript_chunks
        (session_id,turn_id,user_id,sequence,transcript,is_final,audio_bytes,latency_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(session_id,turn_id,sequence) DO NOTHING RETURNING id`, [input.sessionId, input.turnId, input.userId,
        input.sequence, input.transcript, input.final, input.audioBytes, input.latencyMs]);
      if (!inserted.rowCount) return;
      if (input.transcript) await client.query(`UPDATE realtime_voice_sessions SET first_transcript_ms=COALESCE(first_transcript_ms,$1),
        last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=$2`, [input.firstTranscriptMs, input.sessionId]);
      await this.event(client, input.sessionId, input.final ? "transcript.completed" : "transcript.delta", { turnId: input.turnId,
        sequence: input.sequence, transcript: input.transcript, latencyMs: input.latencyMs });
    });
  }

  async turn(sessionId: string, userId: number, turnId: string) {
    const row = (await this.pool.query("SELECT * FROM realtime_voice_turns WHERE id=$1 AND session_id=$2 AND user_id=$3", [turnId, sessionId, userId])).rows[0];
    return row ? { id: String(row.id), intent: String(row.intent), action: this.object(row.action_json),
      agentRunId: row.agent_run_id == null ? null : String(row.agent_run_id) } : null;
  }

  async recordTurnActivity(sessionId: string, firstTranscriptMs: number, interrupted: boolean) {
    await this.pool.query(`UPDATE realtime_voice_sessions SET first_transcript_ms=COALESCE(first_transcript_ms,$1),
      interruption_count=interruption_count+$2,last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=$3`,
    [firstTranscriptMs, interrupted ? 1 : 0, sessionId]);
  }

  async interruptedTurn(sessionId: string, userId: number) {
    const row = (await this.pool.query(`SELECT id,agent_run_id AS "agentRunId" FROM realtime_voice_turns WHERE session_id=$1 AND user_id=$2
      AND intent='question' AND agent_run_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [sessionId, userId])).rows[0];
    return row ? { id: String(row.id), agentRunId: String(row.agentRunId) } : null;
  }

  async recordTurn(input: { id: string; sessionId: string; userId: number; transcript: string; intent: string;
    action: Record<string, unknown>; agentRunId?: string | null; eventType: string; eventPayload: Record<string, unknown> }) {
    await this.tx(async (client) => {
      await client.query(`INSERT INTO realtime_voice_turns(id,session_id,user_id,transcript,intent,action_json,agent_run_id)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [input.id, input.sessionId, input.userId, input.transcript, input.intent,
        JSON.stringify(input.action), input.agentRunId ?? null]);
      await this.event(client, input.sessionId, input.eventType, input.eventPayload);
    });
  }

  async emitEvent(sessionId: string, eventType: string, payload: Record<string, unknown>) {
    return this.tx((client) => this.event(client, sessionId, eventType, payload));
  }

  async appendResponseDelta(input: { sessionId: string; userId: number; turnId: string; runId: string; index: number;
    delta: string; firstResponseMs: number }) {
    return this.tx(async (client) => {
      // Serialize the eligibility check with response.cancelled/session.closed events.
      // Otherwise a cancellation could commit while this transaction is waiting to
      // append its event, leaving a stale delta after the cancellation marker.
      await this.lockEvents(client, input.sessionId);
      const eligible = (await client.query(`SELECT 1 FROM realtime_voice_sessions s
        JOIN realtime_voice_turns t ON t.session_id=s.id AND t.user_id=s.user_id
        WHERE s.id=$1 AND s.user_id=$2 AND s.status IN ('active','muted') AND s.expires_at>CURRENT_TIMESTAMP
          AND t.id=$3 AND t.agent_run_id=$4
          AND NOT EXISTS (SELECT 1 FROM realtime_voice_events e WHERE e.session_id=s.id
            AND e.event_type='response.cancelled' AND e.payload_json->>'turnId'=t.id)`,
      [input.sessionId, input.userId, input.turnId, input.runId])).rows[0];
      if (!eligible) return false;
      await this.event(client, input.sessionId, "response.text.delta",
        { turnId: input.turnId, index: input.index, delta: input.delta, upstream: true });
      await client.query("UPDATE realtime_voice_sessions SET first_response_ms=COALESCE(first_response_ms,$1) WHERE id=$2",
        [input.firstResponseMs, input.sessionId]);
      return true;
    });
  }

  async events(sessionId: string, after: number) {
    return (await this.pool.query(`SELECT sequence,event_type AS type,payload_json AS payload,created_at AS "createdAt"
      FROM realtime_voice_events WHERE session_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100`, [sessionId, after])).rows.map((row) => ({
      sequence: Number(row.sequence), type: String(row.type), payload: this.object(row.payload), createdAt: this.iso(row.createdAt),
    }));
  }

  async completeResponse(input: { sessionId: string; turnId: string; text: string; status: string; firstResponseMs: number }) {
    await this.tx(async (client) => {
      const alreadyStreamed = (await client.query(`SELECT 1 FROM realtime_voice_events
        WHERE session_id=$1 AND event_type='response.text.delta' AND payload_json->>'turnId'=$2 LIMIT 1`,
      [input.sessionId, input.turnId])).rows[0];
      if (!alreadyStreamed) for (const [index, delta] of input.text.split(/(?<=[。！？!?])/).filter(Boolean).entries())
        await this.event(client, input.sessionId, "response.text.delta", { turnId: input.turnId, index, delta, upstream: false });
      await this.event(client, input.sessionId, "response.completed", { turnId: input.turnId, text: input.text, status: input.status });
      await client.query("UPDATE realtime_voice_sessions SET first_response_ms=COALESCE(first_response_ms,$1) WHERE id=$2",
        [input.firstResponseMs, input.sessionId]);
    });
  }

  async pendingRuns(sessionId: string, userId: number) {
    return (await this.pool.query(`SELECT agent_run_id AS "runId" FROM realtime_voice_turns
      WHERE session_id=$1 AND user_id=$2 AND agent_run_id IS NOT NULL`, [sessionId, userId])).rows.map((row) => String(row.runId));
  }

  async close(sessionId: string, userId: number) {
    return this.tx(async (client) => {
      const row = (await client.query(`UPDATE realtime_voice_sessions SET status='closed',version=version+1,closed_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND user_id=$2 AND status<>'closed' RETURNING *`, [sessionId, userId])).rows[0];
      if (row) await this.event(client, sessionId, "session.closed", { rawAudioRetained: false });
      const current = row || (await client.query("SELECT * FROM realtime_voice_sessions WHERE id=$1 AND user_id=$2", [sessionId, userId])).rows[0];
      return current ? this.mapSession(current) : null;
    });
  }

  private async event(client: PoolClient, sessionId: string, eventType: string, payload: Record<string, unknown>) {
    await this.lockEvents(client, sessionId);
    const sequence = Number((await client.query("SELECT COALESCE(MAX(sequence),0)+1 AS value FROM realtime_voice_events WHERE session_id=$1", [sessionId])).rows[0].value);
    await client.query(`INSERT INTO realtime_voice_events(session_id,sequence,event_type,payload_json) VALUES($1,$2,$3,$4::jsonb)`,
      [sessionId, sequence, eventType, JSON.stringify(payload)]);
    return sequence;
  }
  private async lockEvents(client: PoolClient, sessionId: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`realtime-event:${sessionId}`]);
  }
  private object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  private iso(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }
  private mapSession(row: Row): RealtimeVoiceSession {
    return { id: String(row.id), userId: Number(row.user_id), recipeId: Number(row.recipe_id), status: String(row.status),
      platform: String(row.client_platform), context: this.object(row.context_json), version: Number(row.version),
      connectedAt: this.iso(row.connected_at), expiresAt: this.iso(row.expires_at),
      firstTranscriptMs: row.first_transcript_ms == null ? null : Number(row.first_transcript_ms),
      firstResponseMs: row.first_response_ms == null ? null : Number(row.first_response_ms),
      interruptions: Number(row.interruption_count || 0), reconnects: Number(row.reconnect_count || 0), fallbacks: Number(row.fallback_count || 0) };
  }
  private async tx<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
