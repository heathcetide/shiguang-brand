import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { recommendCommunityPosts, type CommunityRecommendationProfile } from "../src/services/communityRecommendation.js";

const now = Date.parse("2026-08-09T12:00:00Z");
const baseProfile: CommunityRecommendationProfile = {
  userId: 42,
  healthGoal: "lose_weight",
  dietaryPreference: "高蛋白",
  restrictedTerms: [],
  likedPosts: [],
};

const post = (input: Partial<Record<string, unknown>> & { id: number; content: string }) => ({
  user_id: input.id,
  category: "寻味",
  image_url: `https://example.com/${input.id}.jpg`,
  likes_count: 100,
  comment_count: 3,
  views_count: 200,
  created_at: "2026-08-08 12:00:00",
  ...input,
});

describe("community recommendation", () => {
  test("fresh relevant posts can outrank old viral fixtures", () => {
    const ranked = recommendCommunityPosts([
      post({ id: 1, content: "普通甜品分享", likes_count: 10_000, created_at: "2026-06-01 12:00:00" }),
      post({ id: 2, content: "15分钟高蛋白低卡鸡胸便当", likes_count: 160 }),
    ], baseProfile, now);

    assert.equal(ranked[0]?.id, 2);
    assert.equal(ranked[0]?.recommendation_reason, "符合你的饮食偏好");
  });

  test("learns topics and authors from likes", () => {
    const ranked = recommendCommunityPosts([
      post({ id: 10, user_id: 7, content: "低糖燕麦早餐", likes_count: 80 }),
      post({ id: 11, user_id: 8, content: "低糖燕麦早餐新做法", likes_count: 80 }),
    ], {
      ...baseProfile,
      dietaryPreference: "",
      likedPosts: [{ user_id: 7, content: "我喜欢低糖燕麦早餐" }],
    }, now);

    assert.equal(ranked[0]?.id, 10);
    assert.equal(ranked[0]?.recommendation_reason, "根据你的点赞偏好");
  });

  test("prioritizes followed authors without repeating one creator continuously", () => {
    const ranked = recommendCommunityPosts([
      post({ id: 20, user_id: 7, content: "低卡鸡胸做法一", author_is_followed: true }),
      post({ id: 21, user_id: 7, content: "低卡鸡胸做法二", author_is_followed: true }),
      post({ id: 22, user_id: 7, content: "低卡鸡胸做法三", author_is_followed: true }),
      post({ id: 23, user_id: 8, content: "高纤蔬菜便当", likes_count: 90 }),
    ], baseProfile, now);

    assert.equal(ranked[0]?.user_id, 7);
    assert.equal(ranked[0]?.recommendation_reason, "关注作者的新动态");
    assert.ok(ranked.slice(0, 3).some((item) => item.user_id === 8));
  });

  test("deduplicates identical content and demotes restricted ingredients", () => {
    const ranked = recommendCommunityPosts([
      post({ id: 30, content: "一锅番茄牛肉蔬菜汤", likes_count: 500 }),
      post({ id: 31, content: "一锅番茄牛肉蔬菜汤", likes_count: 600 }),
      post({ id: 32, content: "坚果酸奶能量杯", likes_count: 8_000 }),
      post({ id: 33, content: "低卡番茄虾仁意面", likes_count: 120 }),
    ], { ...baseProfile, restrictedTerms: ["坚果"] }, now);

    assert.equal(ranked.filter((item) => item.content === "一锅番茄牛肉蔬菜汤").length, 1);
    assert.notEqual(ranked[0]?.id, 32);
  });

  test("is stable for the same user and snapshot", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => post({
      id: index + 100,
      user_id: (index % 5) + 1,
      content: `第${index + 1}条低卡高蛋白便当`,
      likes_count: index * 20,
    }));

    const first = recommendCommunityPosts(candidates, baseProfile, now).map((item) => item.id);
    const second = recommendCommunityPosts(candidates, baseProfile, now).map((item) => item.id);
    assert.deepEqual(first, second);
  });

  test("does not promote test or malformed content into discovery slots", () => {
    const goodPosts = Array.from({ length: 12 }, (_, index) => post({
      id: index + 200,
      user_id: (index % 4) + 1,
      content: `第${index + 1}份新鲜低卡高蛋白工作日便当做法`,
      likes_count: 80 + index * 10,
    }));
    const ranked = recommendCommunityPosts([
      ...goodPosts,
      post({ id: 299, content: "测试 Proposed Changes User Review Required", likes_count: 5_000 }),
      post({ id: 300, content: "好吃！", likes_count: 5_000 }),
    ], baseProfile, now);

    assert.ok(!ranked.slice(0, 10).some((item) => item.id === 299 || item.id === 300));
  });
});
