export type ChatTurnSource = "assistant" | "voice" | "cooking" | "cooking_voice";

export type ChatTurnAudit = {
  userId: number;
  sessionId: string;
  source: ChatTurnSource;
  userContent: string;
  assistantContent: string;
  systemContents?: string[];
  status?: "completed" | "failed";
  payload?: Record<string, unknown> | null;
  confirmationId?: string | null;
  responseTimeMs: number;
  requestedAt: number;
  respondedAt: number;
};

export type StoredChatTurn = {
  userId: number;
  sessionId: string;
  source: ChatTurnSource;
  userContent: string;
  assistantContent: string;
  systemContents: string[];
  status: "completed" | "failed";
  payload: Record<string, unknown> | null;
  confirmationId: string | null;
  responseTimeMs: number;
  requestedAt: string;
  respondedAt: string;
};

export type LegacyInventoryScanJob = {
  id: string;
  status: string;
  result: unknown;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
