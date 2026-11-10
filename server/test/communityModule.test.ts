import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CommunityRepository } from "../src/modules/community/repository.js";
import { CommunityService } from "../src/modules/community/service.js";
import type { LevelSource } from "../src/modules/community/types.js";

const emptyLevel: LevelSource = {
  ruleJson: null,
  dietDates: [],
  dietRecordCount: 0,
  favoriteCount: 0,
  postCount: 0,
  followerCount: 0,
  checkInCount: 0,
  adjustmentXp: 0,
};

function repository(overrides: Partial<CommunityRepository> = {}): CommunityRepository {
  return {
    authUser: async () => null,
    searchUsers: async () => [],
    following: async () => [],
    levelSource: async () => emptyLevel,
    checkedIn: async () => false,
    checkIn: async () => false,
    toggleFollow: async () => ({ kind: "not_found" }),
    profile: async () => null,
    maxPostId: async () => 0,
    listPosts: async () => [],
    viewPost: async () => null,
    share: async () => null,
    resolveShare: async () => null,
    createPost: async () => ({ kind: "linked_recipe_not_public" }),
    toggleJoin: async () => ({ kind: "not_found" }),
    setPostBookmark: async () => ({ kind: "not_found" }),
    togglePostLike: async () => ({ kind: "not_found" }),
    comments: async () => [],
    createComment: async () => null,
    acceptComment: async () => ({ kind: "not_found" }),
    toggleCommentLike: async () => ({ kind: "not_found" }),
    recommendationSource: async () => ({ health: null, likedPosts: [] }),
    ...overrides,
  };
}

describe("community module", () => {
  test("calculates streak, configurable XP and idempotent check-in through database-neutral inputs", async () => {
    let created = true;
    const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const source: LevelSource = {
      ...emptyLevel,
      ruleJson: JSON.stringify({
        levels: [{ level: 1, title: "新手", requiredXp: 0 }, { level: 2, title: "进阶", requiredXp: 20 }],
        xp: { dietRecord: 3, streakDay: 4, recipeFavorite: 1, communityPost: 2, follower: 2, dailyCheckIn: 7 },
      }),
      dietDates: [dateKey(today), dateKey(yesterday)],
      dietRecordCount: 2,
      checkInCount: 1,
    };
    const service = new CommunityService(repository({
      levelSource: async () => source,
      checkIn: async () => { const value = created; created = false; return value; },
    }));
    const level = await service.level(7);
    assert.equal(level.xp, 21);
    assert.equal(level.level, 2);
    const first = await service.checkIn(7, "2026-09-01");
    const second = await service.checkIn(7, "2026-09-01");
    assert.equal(first.status, 201);
    assert.equal(first.body.awardedXp, 7);
    assert.equal(second.status, 200);
    assert.equal(second.body.alreadyCheckedIn, true);
  });

  test("normalizes SQLite and PostgreSQL feed values and emits a stable latest cursor", async () => {
    const service = new CommunityService(repository({
      listPosts: async () => [
        { id: 2, user_id: 8, content: "高蛋白早餐搭配分享", created_at: "2026-09-01T08:00:00.000Z", image_urls: ["/a.jpg"], is_liked: true, is_bookmarked: true, is_joined: false, author_is_followed: true, author_is_expert: false, actual_comment_count: "2" },
        { id: 1, user_id: 9, content: "全麦燕麦早餐搭配分享", created_at: "2026-08-31T08:00:00.000Z", image_urls: JSON.stringify(["/b.jpg"]), is_liked: 0, is_bookmarked: 0, is_joined: 1, author_is_followed: 0, author_is_expert: 1, actual_comment_count: 3 },
      ],
    }));
    const result = await service.posts(null, { pageSize: "1", sort: "latest" });
    if (Array.isArray(result.body)) throw new Error("Expected cursor response");
    assert.equal(result.candidates, 2);
    assert.equal(result.body.items[0].id, 2);
    assert.deepEqual(result.body.items[0].image_urls, ["/a.jpg"]);
    assert.equal(result.body.items[0].comment_count, 2);
    assert.equal(result.body.items[0].is_liked, true);
    assert.equal(result.body.items[0].is_bookmarked, true);
    assert.equal(typeof result.body.nextCursor, "string");
  });

  test("uses JSONB recommendation restrictions and maps transactional domain failures", async () => {
    const service = new CommunityService(repository({
      maxPostId: async () => 2,
      listPosts: async () => [
        { id: 2, user_id: 8, content: "花生高蛋白早餐搭配分享", created_at: "2026-09-01T08:00:00.000Z" },
        { id: 1, user_id: 9, content: "燕麦高纤低糖早餐搭配分享", created_at: "2026-08-31T08:00:00.000Z" },
      ],
      recommendationSource: async () => ({
        health: { health_goal: "lose_weight", allergies_json: [{ name: "花生" }], dietary_restrictions_json: [] },
        likedPosts: [{ user_id: 9, content: "喜欢燕麦早餐" }],
      }),
      toggleFollow: async () => ({ kind: "self" }),
      acceptComment: async () => ({ kind: "forbidden" }),
    }));
    const result = await service.posts(7, { sort: "recommended", limit: 2 });
    if (!Array.isArray(result.body)) throw new Error("Expected offset response");
    assert.equal(result.body[0].id, 1);
    await assert.rejects(() => service.toggleFollow(7, 7), /不能关注自己/);
    await assert.rejects(() => service.acceptComment(7, 2, 4), /只有提问者/);
  });
});
