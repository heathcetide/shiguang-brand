import type { AIWriteAction, AIWriteCommitResult, AIWriteConfirmation, PreparedAIWrite } from "./types.js";

export interface AIWriteConfirmationsRepository {
  createPreview(input: { id: string; userId: number; action: AIWriteAction; payload: Record<string, unknown>;
    conversationId?: string; sourceMessageId?: string }): Promise<{ expiresAt: string }>;
  confirmation(id: string, userId: number): Promise<AIWriteConfirmation | null>;
  commit(input: { id: string; userId: number; idempotencyKey: string; prepared: PreparedAIWrite }): Promise<AIWriteCommitResult>;
}
