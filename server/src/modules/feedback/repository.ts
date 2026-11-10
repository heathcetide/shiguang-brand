import type { FeedbackCreateData, FeedbackDetail, FeedbackItem, FeedbackListQuery, FeedbackReply } from "./types.js";
export interface FeedbackRepository {
  create(userId: number, input: FeedbackCreateData): Promise<number>;
  list(userId: number | null, query: FeedbackListQuery): Promise<FeedbackItem[]>;
  detail(userId: number | null, id: number): Promise<FeedbackDetail | null>;
  reply(actorId: number, admin: boolean, id: number, input: FeedbackReply): Promise<void>;
}
