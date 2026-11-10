import type {
  AcceptResult, AuthUser, CreatePostInput, CreatePostResult, JoinResult, LevelSource, PostListInput, ProfileResult,
  RecommendationSource, Row, ShareResult, ToggleResult,
} from "./types.js";

export interface CommunityRepository {
  authUser(userId: number): Promise<AuthUser | null>;
  searchUsers(viewerId: number | null, pattern: string): Promise<Row[]>;
  following(userId: number): Promise<Row[]>;
  levelSource(userId: number): Promise<LevelSource>;
  checkedIn(userId: number, date: string): Promise<boolean>;
  checkIn(userId: number, date: string): Promise<boolean>;
  toggleFollow(userId: number, followingId: number): Promise<ToggleResult | { kind: "self" }>;
  profile(viewerId: number | null, profileUserId: number): Promise<ProfileResult>;
  maxPostId(): Promise<number>;
  listPosts(input: PostListInput): Promise<Row[]>;
  viewPost(userId: number | null, postId: number): Promise<Row | null>;
  share(postId: number, userId: number | null, codes: string[], expiresAt: string): Promise<ShareResult | "not_found">;
  resolveShare(code: string): Promise<Row | null>;
  createPost(input: CreatePostInput): Promise<CreatePostResult>;
  toggleJoin(userId: number, postId: number, now: number): Promise<JoinResult>;
  setPostBookmark(userId: number, postId: number, bookmarked: boolean): Promise<{ kind: "not_found" } | { kind: "updated"; bookmarked: boolean }>;
  togglePostLike(userId: number, postId: number): Promise<ToggleResult>;
  comments(userId: number | null, postId: number): Promise<Row[]>;
  createComment(userId: number, postId: number, username: string, avatarUrl: string | null, content: string, imageUrl: string | null): Promise<Row | null>;
  acceptComment(userId: number, postId: number, commentId: number): Promise<AcceptResult>;
  toggleCommentLike(userId: number, commentId: number): Promise<ToggleResult>;
  recommendationSource(userId: number | null): Promise<RecommendationSource>;
}
