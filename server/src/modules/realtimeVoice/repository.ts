import type { CreateSessionResult, RealtimeVoiceEvent, RealtimeVoiceSession, RealtimeVoiceTurn, TranscriptChunk } from "./types.js";

export interface RealtimeVoiceRepository {
  createSession(input: { id: string; userId: number; recipeId: number; platform: string; context: Record<string, unknown>; idempotencyKey: string }): Promise<CreateSessionResult>;
  session(sessionId: string, userId: number): Promise<RealtimeVoiceSession | null>;
  heartbeat(sessionId: string, userId: number, version: number, status: string, reconnect: boolean): Promise<RealtimeVoiceSession | null>;
  transcript(sessionId: string, turnId: string, sequence: number): Promise<TranscriptChunk | null>;
  recordTranscript(input: { sessionId: string; turnId: string; userId: number; sequence: number; transcript: string; final: boolean;
    audioBytes: number; latencyMs: number; firstTranscriptMs: number }): Promise<void>;
  turn(sessionId: string, userId: number, turnId: string): Promise<RealtimeVoiceTurn | null>;
  recordTurnActivity(sessionId: string, firstTranscriptMs: number, interrupted: boolean): Promise<void>;
  interruptedTurn(sessionId: string, userId: number): Promise<{ id: string; agentRunId: string } | null>;
  recordTurn(input: { id: string; sessionId: string; userId: number; transcript: string; intent: string;
    action: Record<string, unknown>; agentRunId?: string | null; eventType: string; eventPayload: Record<string, unknown> }): Promise<void>;
  emitEvent(sessionId: string, eventType: string, payload: Record<string, unknown>): Promise<number>;
  appendResponseDelta(input: { sessionId: string; userId: number; turnId: string; runId: string; index: number;
    delta: string; firstResponseMs: number }): Promise<boolean>;
  events(sessionId: string, after: number): Promise<RealtimeVoiceEvent[]>;
  completeResponse(input: { sessionId: string; turnId: string; text: string; status: string; firstResponseMs: number }): Promise<void>;
  pendingRuns(sessionId: string, userId: number): Promise<string[]>;
  close(sessionId: string, userId: number): Promise<RealtimeVoiceSession | null>;
}
