import type Database from "better-sqlite3";
import type { RealtimeVoiceRepository } from "./repository.js";
import type { RealtimeVoiceSession } from "./types.js";

type Row = Record<string, unknown>;

export class SqliteRealtimeVoiceRepository implements RealtimeVoiceRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async createSession(input: { id: string; userId: number; recipeId: number; platform: string; context: Record<string, unknown>; idempotencyKey: string }) {
    return this.atomic(() => {
      const recipe = this.database.prepare("SELECT id,title FROM recipes WHERE id=? AND status='approved' AND deleted_at IS NULL")
        .get(input.recipeId) as { id: number; title: string } | undefined;
      if (!recipe) return { status: "recipe_missing" as const };
      const existing = this.database.prepare("SELECT * FROM realtime_voice_sessions WHERE user_id=? AND idempotency_key=?")
        .get(input.userId, input.idempotencyKey) as Row | undefined;
      if (existing) return { status: "repeated" as const, session: this.mapSession(existing) };
      this.database.prepare(`INSERT INTO realtime_voice_sessions(id,user_id,recipe_id,client_platform,context_json,idempotency_key,expires_at)
        VALUES(?,?,?,?,?,?,datetime('now','+2 hour'))`).run(input.id, input.userId, recipe.id, input.platform,
        JSON.stringify({ recipeTitle: recipe.title, ...input.context }), input.idempotencyKey);
      this.event(input.id, "session.ready", { transport: "event-stream", rawAudioRetained: false, vad: "client" });
      return { status: "created" as const, session: this.mapSession(this.sessionRow(input.id, input.userId)!) };
    });
  }

  async session(sessionId: string, userId: number) {
    const row = this.sessionRow(sessionId, userId);
    return row ? this.mapSession(row) : null;
  }

  async heartbeat(sessionId: string, userId: number, version: number, status: string, reconnect: boolean) {
    const changed = this.database.prepare(`UPDATE realtime_voice_sessions SET status=?,version=version+1,
      reconnect_count=reconnect_count+?,last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=? AND status<>'closed'`)
      .run(status, reconnect ? 1 : 0, sessionId, userId, version).changes;
    if (!changed) return null;
    return this.mapSession(this.sessionRow(sessionId, userId)!);
  }

  async transcript(sessionId: string, turnId: string, sequence: number) {
    const row = this.database.prepare(`SELECT transcript,is_final AS final,latency_ms AS latencyMs FROM realtime_voice_transcript_chunks
      WHERE session_id=? AND turn_id=? AND sequence=?`).get(sessionId, turnId, sequence) as Row | undefined;
    return row ? { transcript: String(row.transcript), final: Boolean(row.final), latencyMs: Number(row.latencyMs) } : null;
  }

  async recordTranscript(input: { sessionId: string; turnId: string; userId: number; sequence: number; transcript: string;
    final: boolean; audioBytes: number; latencyMs: number; firstTranscriptMs: number }) {
    this.atomic(() => {
      const inserted = this.database.prepare(`INSERT OR IGNORE INTO realtime_voice_transcript_chunks
        (session_id,turn_id,user_id,sequence,transcript,is_final,audio_bytes,latency_ms) VALUES(?,?,?,?,?,?,?,?)`)
        .run(input.sessionId, input.turnId, input.userId, input.sequence, input.transcript, Number(input.final), input.audioBytes, input.latencyMs);
      if (!inserted.changes) return;
      if (input.transcript) this.database.prepare(`UPDATE realtime_voice_sessions SET first_transcript_ms=COALESCE(first_transcript_ms,?),
        last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=?`).run(input.firstTranscriptMs, input.sessionId);
      this.event(input.sessionId, input.final ? "transcript.completed" : "transcript.delta", { turnId: input.turnId,
        sequence: input.sequence, transcript: input.transcript, latencyMs: input.latencyMs });
    });
  }

  async turn(sessionId: string, userId: number, turnId: string) {
    const row = this.database.prepare("SELECT * FROM realtime_voice_turns WHERE id=? AND session_id=? AND user_id=?")
      .get(turnId, sessionId, userId) as Row | undefined;
    return row ? { id: String(row.id), intent: String(row.intent), action: this.object(row.action_json),
      agentRunId: row.agent_run_id == null ? null : String(row.agent_run_id) } : null;
  }

  async recordTurnActivity(sessionId: string, firstTranscriptMs: number, interrupted: boolean) {
    this.database.prepare(`UPDATE realtime_voice_sessions SET first_transcript_ms=COALESCE(first_transcript_ms,?),
      interruption_count=interruption_count+?,last_heartbeat_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(firstTranscriptMs, interrupted ? 1 : 0, sessionId);
  }

  async interruptedTurn(sessionId: string, userId: number) {
    const row = this.database.prepare(`SELECT id,agent_run_id AS agentRunId FROM realtime_voice_turns WHERE session_id=? AND user_id=?
      AND intent='question' AND agent_run_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(sessionId, userId) as Row | undefined;
    return row ? { id: String(row.id), agentRunId: String(row.agentRunId) } : null;
  }

  async recordTurn(input: { id: string; sessionId: string; userId: number; transcript: string; intent: string;
    action: Record<string, unknown>; agentRunId?: string | null; eventType: string; eventPayload: Record<string, unknown> }) {
    this.atomic(() => {
      this.database.prepare(`INSERT INTO realtime_voice_turns(id,session_id,user_id,transcript,intent,action_json,agent_run_id)
        VALUES(?,?,?,?,?,?,?)`).run(input.id, input.sessionId, input.userId, input.transcript, input.intent,
        JSON.stringify(input.action), input.agentRunId ?? null);
      this.event(input.sessionId, input.eventType, input.eventPayload);
    });
  }

  async emitEvent(sessionId: string, eventType: string, payload: Record<string, unknown>) {
    return this.atomic(() => this.event(sessionId, eventType, payload));
  }

  async appendResponseDelta(input: { sessionId: string; userId: number; turnId: string; runId: string; index: number;
    delta: string; firstResponseMs: number }) {
    return this.atomic(() => {
      const eligible = this.database.prepare(`SELECT 1 FROM realtime_voice_sessions s
        JOIN realtime_voice_turns t ON t.session_id=s.id AND t.user_id=s.user_id
        WHERE s.id=? AND s.user_id=? AND s.status IN ('active','muted') AND datetime(s.expires_at)>CURRENT_TIMESTAMP
          AND t.id=? AND t.agent_run_id=?
          AND NOT EXISTS (SELECT 1 FROM realtime_voice_events e WHERE e.session_id=s.id
            AND e.event_type='response.cancelled' AND json_extract(e.payload_json,'$.turnId')=t.id)`)
        .get(input.sessionId, input.userId, input.turnId, input.runId);
      if (!eligible) return false;
      this.event(input.sessionId, "response.text.delta", { turnId: input.turnId, index: input.index, delta: input.delta, upstream: true });
      this.database.prepare("UPDATE realtime_voice_sessions SET first_response_ms=COALESCE(first_response_ms,?) WHERE id=?")
        .run(input.firstResponseMs, input.sessionId);
      return true;
    });
  }

  async events(sessionId: string, after: number) {
    return (this.database.prepare(`SELECT sequence,event_type,payload_json,created_at FROM realtime_voice_events
      WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 100`).all(sessionId, after) as Row[]).map((row) => ({
      sequence: Number(row.sequence), type: String(row.event_type), payload: this.object(row.payload_json), createdAt: String(row.created_at),
    }));
  }

  async completeResponse(input: { sessionId: string; turnId: string; text: string; status: string; firstResponseMs: number }) {
    this.atomic(() => {
      const alreadyStreamed = this.database.prepare(`SELECT 1 FROM realtime_voice_events
        WHERE session_id=? AND event_type='response.text.delta' AND json_extract(payload_json,'$.turnId')=? LIMIT 1`)
        .get(input.sessionId, input.turnId);
      if (!alreadyStreamed) input.text.split(/(?<=[。！？!?])/).filter(Boolean).forEach((delta, index) =>
        this.event(input.sessionId, "response.text.delta", { turnId: input.turnId, index, delta, upstream: false }));
      this.event(input.sessionId, "response.completed", { turnId: input.turnId, text: input.text, status: input.status });
      this.database.prepare("UPDATE realtime_voice_sessions SET first_response_ms=COALESCE(first_response_ms,?) WHERE id=?")
        .run(input.firstResponseMs, input.sessionId);
    });
  }

  async pendingRuns(sessionId: string, userId: number) {
    return (this.database.prepare(`SELECT agent_run_id AS runId FROM realtime_voice_turns WHERE session_id=? AND user_id=? AND agent_run_id IS NOT NULL`)
      .all(sessionId, userId) as Array<{ runId: string }>).map((row) => row.runId);
  }

  async close(sessionId: string, userId: number) {
    return this.atomic(() => {
      const changed = this.database.prepare(`UPDATE realtime_voice_sessions SET status='closed',version=version+1,closed_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=? AND status<>'closed'`).run(sessionId, userId).changes;
      if (changed) this.event(sessionId, "session.closed", { rawAudioRetained: false });
      const row = this.sessionRow(sessionId, userId);
      return row ? this.mapSession(row) : null;
    });
  }

  private sessionRow(sessionId: string, userId: number) {
    return this.database.prepare("SELECT * FROM realtime_voice_sessions WHERE id=? AND user_id=?").get(sessionId, userId) as Row | undefined;
  }
  private atomic<T>(work: () => T) { return this.database.transaction(work)(); }
  private event(sessionId: string, eventType: string, payload: Record<string, unknown>) {
    const sequence = Number((this.database.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS value FROM realtime_voice_events WHERE session_id=?`)
      .get(sessionId) as { value: number }).value);
    this.database.prepare(`INSERT INTO realtime_voice_events(session_id,sequence,event_type,payload_json) VALUES(?,?,?,?)`)
      .run(sessionId, sequence, eventType, JSON.stringify(payload));
    return sequence;
  }
  private object(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  private mapSession(row: Row): RealtimeVoiceSession {
    return { id: String(row.id), userId: Number(row.user_id), recipeId: Number(row.recipe_id), status: String(row.status),
      platform: String(row.client_platform), context: this.object(row.context_json), version: Number(row.version),
      connectedAt: String(row.connected_at), expiresAt: String(row.expires_at),
      firstTranscriptMs: row.first_transcript_ms == null ? null : Number(row.first_transcript_ms),
      firstResponseMs: row.first_response_ms == null ? null : Number(row.first_response_ms),
      interruptions: Number(row.interruption_count || 0), reconnects: Number(row.reconnect_count || 0), fallbacks: Number(row.fallback_count || 0) };
  }
}
