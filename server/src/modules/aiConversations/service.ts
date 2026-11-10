import type { AIConversationsRepository } from "./repository.js";
import type { ChatTurnAudit } from "./types.js";

export class AIConversationsService {
  private readonly repository: AIConversationsRepository;
  constructor(repository: AIConversationsRepository) { this.repository = repository; }

  async recordTurn(input: ChatTurnAudit) {
    const sessionId = input.sessionId.trim().slice(0, 120);
    if (!sessionId) throw new Error("AI_CHAT_SESSION_REQUIRED");
    const payload = this.normalizedPayload(input.payload ?? null);
    return this.repository.recordTurn({
      userId: input.userId,
      sessionId,
      source: input.source,
      userContent: input.userContent.slice(0, 12_000),
      assistantContent: input.assistantContent.slice(0, 12_000),
      systemContents: [...new Set((input.systemContents ?? []).map((content) => content.trim()).filter(Boolean))]
        .map((content) => content.slice(0, 12_000)),
      status: input.status ?? "completed",
      payload,
      confirmationId: input.confirmationId ?? null,
      responseTimeMs: Math.max(0, Math.round(input.responseTimeMs)),
      requestedAt: this.iso(input.requestedAt),
      respondedAt: this.iso(input.respondedAt),
    });
  }

  async deleteConversation(userId: number, sessionId: string) {
    const normalized = sessionId.trim();
    if (!normalized || normalized.length > 120) throw new Error("AI_CHAT_SESSION_INVALID");
    return this.repository.deleteConversation(userId, normalized);
  }

  legacyInventoryScanJob(id: string, userId: number) {
    return this.repository.legacyInventoryScanJob(id, userId);
  }

  private iso(timestamp: number) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) throw new Error("AI_CHAT_TIMESTAMP_INVALID");
    return date.toISOString();
  }

  private normalizedPayload(payload: Record<string, unknown> | null) {
    if (!payload) return null;
    const serialized = JSON.stringify(payload);
    if (serialized.length <= 50_000) return payload;
    return { truncated: true, preview: serialized.slice(0, 49_900) };
  }
}
