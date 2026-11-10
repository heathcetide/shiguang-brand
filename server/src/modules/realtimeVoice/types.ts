export interface RealtimeVoiceSession {
  id: string;
  userId: number;
  recipeId: number;
  status: string;
  platform: string;
  context: Record<string, unknown>;
  version: number;
  connectedAt: string;
  expiresAt: string;
  firstTranscriptMs: number | null;
  firstResponseMs: number | null;
  interruptions: number;
  reconnects: number;
  fallbacks: number;
}

export interface RealtimeVoiceTurn {
  id: string;
  intent: string;
  action: Record<string, unknown>;
  agentRunId: string | null;
}

export interface RealtimeVoiceEvent {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TranscriptChunk {
  transcript: string;
  final: boolean;
  latencyMs: number;
}

export type CreateSessionResult =
  | { status: "recipe_missing" }
  | { status: "created" | "repeated"; session: RealtimeVoiceSession };
