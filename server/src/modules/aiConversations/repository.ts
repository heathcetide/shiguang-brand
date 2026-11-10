import type { LegacyInventoryScanJob, StoredChatTurn } from "./types.js";

export interface AIConversationsRepository {
  recordTurn(turn: StoredChatTurn): Promise<boolean>;
  deleteConversation(userId: number, sessionId: string): Promise<number>;
  legacyInventoryScanJob(id: string, userId: number): Promise<LegacyInventoryScanJob | null>;
}
