import { communityBookmarkResponseSchema } from "@dietdigidose/contracts";
import { requestJson, publicFetch, type ApiFetch } from "./client";
import type { CommunityPost } from "./types";

export const communityApi = {
  posts: <T = CommunityPost>(query = "", apiFetch: ApiFetch = publicFetch) => requestJson<T[]>(apiFetch, `/api/v1/community/posts${query}`),
  postPage: <T = CommunityPost>(query = "", apiFetch: ApiFetch = publicFetch) => requestJson<{ items: T[]; nextCursor: string | null }>(apiFetch, `/api/v1/community/posts${query}`),
  users: <T>(apiFetch: ApiFetch, query: string) => requestJson<T[]>(apiFetch, `/api/v1/community/users?query=${encodeURIComponent(query)}`),
  following: <T>(apiFetch: ApiFetch) => requestJson<T[]>(apiFetch, "/api/v1/community/following"),
  level: <T>(apiFetch: ApiFetch) => requestJson<T>(apiFetch, "/api/v1/community/level"),
  checkInStatus: <T>(apiFetch: ApiFetch) => requestJson<T>(apiFetch, "/api/v1/community/check-in"),
  checkIn: <T>(apiFetch: ApiFetch) => requestJson<T>(apiFetch, "/api/v1/community/check-in", { method: "POST" }),
  userProfile: <T>(apiFetch: ApiFetch, userId: number) => requestJson<T>(apiFetch, `/api/v1/community/users/${userId}/profile`),
  toggleFollow: (apiFetch: ApiFetch, userId: number) => requestJson<{ is_following: boolean; following_count: number }>(apiFetch, `/api/v1/community/users/${userId}/follow`, { method: "POST" }),
  post: <T = CommunityPost>(id: number, apiFetch: ApiFetch = publicFetch) => requestJson<T>(apiFetch, `/api/v1/community/posts/${id}`, { cache: "no-store" }),
  createShare: (apiFetch: ApiFetch, id: number) => requestJson<{ code: string; url: string; app_url: string; expires_at: string }>(apiFetch, `/api/v1/community/posts/${id}/share`, { method: "POST" }),
  resolveShare: (code: string, apiFetch: ApiFetch = publicFetch) => requestJson<{ post_id: number; expires_at: string }>(apiFetch, `/api/v1/community/shares/${encodeURIComponent(code)}`),
  createPost: (apiFetch: ApiFetch, input: unknown) => requestJson<CommunityPost>(apiFetch, "/api/v1/community/posts", { method: "POST", body: JSON.stringify(input) }),
  setBookmark: (apiFetch: ApiFetch, id: number, bookmarked: boolean) => requestJson<{ bookmarked: boolean }>(apiFetch, `/api/v1/community/posts/${id}/bookmark`, { method: bookmarked ? "PUT" : "DELETE" }, communityBookmarkResponseSchema),
  toggleLike: (apiFetch: ApiFetch, id: number) => requestJson<{ is_liked: boolean; likes_count: number }>(apiFetch, `/api/v1/community/posts/${id}/like`, { method: "POST" }),
  toggleJoin: (apiFetch: ApiFetch, id: number) => requestJson<{ is_joined: boolean; participant_count: number }>(apiFetch, `/api/v1/community/posts/${id}/join`, { method: "POST" }),
  comments: <T>(id: number, apiFetch: ApiFetch = publicFetch) => requestJson<T[]>(apiFetch, `/api/v1/community/posts/${id}/comments`),
  createComment: <T>(apiFetch: ApiFetch, id: number, input: unknown) => requestJson<T>(apiFetch, `/api/v1/community/posts/${id}/comments`, { method: "POST", body: JSON.stringify(input) }),
  acceptComment: <T = { success: boolean }>(apiFetch: ApiFetch, postId: number, commentId: number) => requestJson<T>(apiFetch, `/api/v1/community/posts/${postId}/comments/${commentId}/accept`, { method: "POST" }),
  toggleCommentLike: (apiFetch: ApiFetch, id: number) => requestJson<{ is_liked: boolean; likes_count: number }>(apiFetch, `/api/v1/community/comments/${id}/like`, { method: "POST" }),
};
