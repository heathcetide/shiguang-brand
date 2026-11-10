import type { FeedbackRepository } from "./repository.js";
import type { FeedbackCreateData, FeedbackListQuery, FeedbackReply } from "./types.js";
import { missingFeedback } from "./domain.js";
export class FeedbackService {
  private readonly repository: FeedbackRepository;
  constructor(repository: FeedbackRepository) { this.repository = repository; }
  async create(userId: number, input: FeedbackCreateData) { return { id: await this.repository.create(userId, input), status: "received" as const }; }
  async list(userId: number | null, query: FeedbackListQuery) {
    const items = await this.repository.list(userId, { ...query, limit: query.limit + 1 });
    return { items: items.slice(0, query.limit), nextCursor: items.length > query.limit ? items[query.limit - 1]!.id : null };
  }
  async detail(userId: number | null, id: number) { const item = await this.repository.detail(userId, id); if (!item) throw missingFeedback(); return item; }
  async reply(actorId: number, admin: boolean, id: number, input: FeedbackReply) {
    await this.repository.reply(actorId, admin, id, input);
    return this.detail(admin ? null : actorId, id);
  }
}
