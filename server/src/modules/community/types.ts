export type Row = Record<string, any>;
export type AuthUser = { id: number; username: string; avatar_url: string | null; role: string; is_verified_expert: number | boolean };
export type LevelSource = {
  ruleJson: string | null; dietDates: string[]; dietRecordCount: number; favoriteCount: number;
  postCount: number; followerCount: number; checkInCount: number; adjustmentXp: number;
};
export type PostListInput = {
  userId: number | null; category: string; search: string; latestCursor?: { createdAt: string; id: number };
  snapshotMaxId?: number; limit: number; offset: number;
};
export type CreatePostInput = {
  userId: number; username: string; avatarUrl: string | null; category: string; content: string; imageUrls: string[];
  eventStartAt: string | null; eventEndAt: string | null; questionStatus: string | null; ipLocation: string | null;
  linkedRecipeId: number | null;
};
export type CreatePostResult = { kind: "created"; post: Row } | { kind: "linked_recipe_not_public" };
export type ShareResult = { code: string; expires_at: string; created: boolean } | null;
export type ToggleResult = { kind: "not_found" } | { kind: "updated"; active: boolean; count: number };
export type JoinResult = ToggleResult | { kind: "ended" };
export type AcceptResult =
  | { kind: "not_found" }
  | { kind: "not_question" }
  | { kind: "comment_not_found" }
  | { kind: "forbidden" }
  | { kind: "updated"; acceptedCommentId: number | null };
export type ProfileResult = { user: Row; posts: Row[] } | null;
export type RecommendationSource = { health: Row | null; likedPosts: Array<{ user_id: number; content: string }> };
