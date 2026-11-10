export interface CommunityRecommendationPost {
  id: number;
  user_id?: number | null;
  content?: string | null;
  category?: string | null;
  image_url?: string | null;
  likes_count?: number | null;
  comment_count?: number | null;
  views_count?: number | null;
  created_at?: string | null;
  is_liked?: boolean;
  author_is_followed?: boolean;
  [key: string]: unknown;
}

export interface CommunityRecommendationProfile {
  userId: number | null;
  healthGoal?: string | null;
  dietaryPreference?: string | null;
  restrictedTerms?: string[];
  likedPosts?: Array<{ user_id?: number | null; content?: string | null }>;
}

interface TopicDefinition {
  id: string;
  keywords: string[];
}

interface ScoredPost<T extends CommunityRecommendationPost> {
  post: T;
  baseScore: number;
  freshnessScore: number;
  explorationScore: number;
  topics: string[];
  normalizedContent: string;
  reason: string;
  eligible: boolean;
}

const TOPICS: TopicDefinition[] = [
  { id: "high_protein", keywords: ["高蛋白", "蛋白质", "鸡胸", "牛肉", "虾仁", "三文鱼", "鱼肉", "增肌"] },
  { id: "low_calorie", keywords: ["低卡", "减脂", "轻食", "低脂", "控卡", "饱腹"] },
  { id: "low_sugar", keywords: ["低糖", "无糖", "控糖", "戒糖", "血糖"] },
  { id: "high_fiber", keywords: ["高纤", "膳食纤维", "蔬菜", "沙拉", "全麦", "燕麦", "藜麦"] },
  { id: "quick_meal", keywords: ["快手", "分钟", "便当", "早餐", "工作日", "空气炸锅"] },
  { id: "family", keywords: ["家常", "家庭", "儿童", "孕期", "全家", "一锅"] },
  { id: "vegetarian", keywords: ["素食", "纯素", "蔬食", "豆腐", "豆类"] },
  { id: "storage", keywords: ["储存", "保鲜", "分装", "收纳", "临期"] },
  { id: "hydration", keywords: ["喝水", "补水", "饮水"] },
];

const GOAL_TOPICS: Record<string, string[]> = {
  lose_weight: ["low_calorie", "high_fiber", "high_protein", "low_sugar"],
  reduce_fat: ["low_calorie", "high_fiber", "high_protein", "low_sugar"],
  gain_muscle: ["high_protein", "quick_meal"],
  maintain: ["high_fiber", "family", "quick_meal"],
  healthy: ["high_fiber", "low_sugar", "high_protein"],
};

const normalizeText = (value: unknown) => String(value || "")
  .toLowerCase()
  .replace(/[\p{P}\p{S}\s]+/gu, "");

const splitPreferenceTerms = (value: unknown) => String(value || "")
  .split(/[、,，/;；\s]+/)
  .map((term) => normalizeText(term))
  .filter((term) => term.length > 1 && term !== "无特别偏好");

const topicsForText = (text: string) => TOPICS
  .filter((topic) => topic.keywords.some((keyword) => text.includes(normalizeText(keyword))))
  .map((topic) => topic.id);

const parseCreatedAt = (value: unknown) => {
  const raw = String(value || "");
  const normalized = raw.replace(" ", "T");
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = Date.parse(hasExplicitTimezone ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

const stableUnit = (seed: string) => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
};

const overlapCount = (left: string[], right: string[]) => {
  const rightSet = new Set(right);
  return left.reduce((count, value) => count + (rightSet.has(value) ? 1 : 0), 0);
};

function buildInterestProfile(profile: CommunityRecommendationProfile) {
  const topicWeights = new Map<string, number>();
  const authorWeights = new Map<number, number>();
  const goalTopics = GOAL_TOPICS[profile.healthGoal || "healthy"] || GOAL_TOPICS.healthy;

  for (const topic of goalTopics) topicWeights.set(topic, (topicWeights.get(topic) || 0) + 2.5);
  for (const liked of profile.likedPosts || []) {
    const likedText = normalizeText(liked.content);
    for (const topic of topicsForText(likedText)) {
      topicWeights.set(topic, Math.min(10, (topicWeights.get(topic) || 0) + 2.25));
    }
    if (liked.user_id) authorWeights.set(liked.user_id, Math.min(4, (authorWeights.get(liked.user_id) || 0) + 1));
  }

  return {
    topicWeights,
    authorWeights,
    goalTopics: new Set(goalTopics),
    preferenceTerms: splitPreferenceTerms(profile.dietaryPreference),
    restrictedTerms: (profile.restrictedTerms || []).map(normalizeText).filter((term) => term.length > 1),
  };
}

function scorePost<T extends CommunityRecommendationPost>(
  post: T,
  profile: CommunityRecommendationProfile,
  now: number,
  interests: ReturnType<typeof buildInterestProfile>,
): ScoredPost<T> {
  const normalizedContent = normalizeText(`${post.content || ""}${post.category || ""}`);
  const topics = topicsForText(normalizedContent);
  const createdAt = parseCreatedAt(post.created_at);
  const ageDays = createdAt === null ? 30 : Math.max(0, (now - createdAt) / 86_400_000);
  const freshnessScore = 30 * Math.exp(-ageDays / 10);
  const likes = Math.max(0, Number(post.likes_count) || 0);
  const comments = Math.max(0, Number(post.comment_count) || 0);
  const views = Math.max(0, Number(post.views_count) || 0);
  const popularityScore = Math.log1p(Math.min(likes, 3_000)) * 3
    + Math.log1p(Math.min(comments, 500)) * 2.2
    + Math.log1p(Math.min(views, 20_000)) * 0.45;
  const topicScore = Math.min(28, topics.reduce((score, topic) => score + (interests.topicWeights.get(topic) || 0), 0));
  const goalMatch = topics.some((topic) => interests.goalTopics.has(topic));
  const preferenceMatch = interests.preferenceTerms.some((term) => normalizedContent.includes(term));
  const restrictedMatch = interests.restrictedTerms.some((term) => normalizedContent.includes(term));
  const followedAuthor = Boolean(post.author_is_followed);
  const authorAffinity = post.user_id ? (interests.authorWeights.get(post.user_id) || 0) : 0;
  const contentLength = normalizedContent.length;
  const suspiciousContent = /(?:测试|实施计划|问题根因|proposedchanges|userreviewrequired|https?:\/\/)/i.test(String(post.content || ""));
  const qualityPenalty = (contentLength < 12 ? 18 : 0)
    + (contentLength > 260 ? Math.min(55, (contentLength - 260) * 0.18) : 0)
    + (suspiciousContent ? 55 : 0);
  const dayBucket = Math.floor(now / 86_400_000);
  const random = stableUnit(`${profile.userId || 0}:${dayBucket}:${post.id}`);
  const discoveryBoost = random * (likes < 1_000 ? 11 : 4);
  const alreadyLikedPenalty = post.is_liked ? 9 : 0;
  const ownPostPenalty = profile.userId && post.user_id === profile.userId ? 7 : 0;
  const restrictionPenalty = restrictedMatch ? 70 : 0;
  const baseScore = popularityScore
    + freshnessScore
    + topicScore
    + (goalMatch ? 6 : 0)
    + (preferenceMatch ? 9 : 0)
    + (followedAuthor ? 20 : 0)
    + authorAffinity * 3
    + discoveryBoost
    - alreadyLikedPenalty
    - ownPostPenalty
    - restrictionPenalty
    - qualityPenalty;

  let reason = "社区热议";
  if (followedAuthor) reason = "关注作者的新动态";
  else if (topicScore >= 8 && (profile.likedPosts?.length || 0) > 0) reason = "根据你的点赞偏好";
  else if (preferenceMatch) reason = "符合你的饮食偏好";
  else if (goalMatch) reason = "贴合你的健康目标";
  else if (ageDays < 3) reason = "新鲜发布";

  return {
    post,
    baseScore,
    freshnessScore,
    explorationScore: baseScore * 0.45 + freshnessScore * 0.8 + random * 18,
    topics,
    normalizedContent,
    reason,
    eligible: !restrictedMatch && !suspiciousContent && contentLength >= 12,
  };
}

/**
 * Hybrid community ranker: personal relevance + freshness + bounded quality,
 * followed by exact-content deduplication, author/topic diversity and a stable
 * 20% discovery lane. The daily deterministic seed keeps cursor pages stable.
 */
export function recommendCommunityPosts<T extends CommunityRecommendationPost>(
  posts: T[],
  profile: CommunityRecommendationProfile,
  now = Date.now(),
) {
  const interests = buildInterestProfile(profile);
  const bestByContent = new Map<string, ScoredPost<T>>();

  for (const post of posts) {
    const scored = scorePost(post, profile, now, interests);
    const dedupeKey = scored.normalizedContent || `post:${post.id}`;
    const current = bestByContent.get(dedupeKey);
    if (!current || scored.baseScore > current.baseScore) bestByContent.set(dedupeKey, scored);
  }

  const remaining = [...bestByContent.values()]
    .sort((left, right) => right.baseScore - left.baseScore || right.post.id - left.post.id);
  const selected: ScoredPost<T>[] = [];

  while (remaining.length) {
    const slot = selected.length;
    const recent = selected.slice(-3);
    const discoverySlot = slot > 0 && (slot + 1) % 5 === 0;
    const eligibleRemaining = remaining.filter((candidate) => candidate.eligible);
    const poolSource = eligibleRemaining.length ? eligibleRemaining : remaining;
    const regularPool = poolSource.slice(0, Math.min(8, poolSource.length));
    const discoveryFloor = Math.max(35, (poolSource[0]?.baseScore || 0) - 30);
    const discoveryPool = poolSource
      .slice(0, Math.min(14, poolSource.length))
      .filter((candidate) => candidate.baseScore >= discoveryFloor);
    const candidatePool = discoverySlot && discoveryPool.length ? discoveryPool : regularPool;
    let best = candidatePool[0];
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidatePool) {
      const repeatedAuthor = recent.filter((item) => item.post.user_id && item.post.user_id === candidate.post.user_id).length;
      const repeatedTopics = recent.reduce((count, item) => count + overlapCount(item.topics, candidate.topics), 0);
      const repeatedImage = recent.some((item) => item.post.image_url && item.post.image_url === candidate.post.image_url);
      const diversityPenalty = repeatedAuthor * 13 + repeatedTopics * 5 + (repeatedImage ? 6 : 0);
      const adjustedScore = (discoverySlot ? candidate.explorationScore : candidate.baseScore) - diversityPenalty;
      if (adjustedScore > bestAdjustedScore || (adjustedScore === bestAdjustedScore && candidate.post.id > best.post.id)) {
        best = candidate;
        bestAdjustedScore = adjustedScore;
      }
    }

    if (discoverySlot && best.reason === "社区热议") best.reason = "为你发现新内容";
    selected.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }

  return selected.map(({ post, baseScore, reason }) => ({
    ...post,
    recommendation_score: Math.round(baseScore * 10) / 10,
    recommendation_reason: reason,
  }));
}
