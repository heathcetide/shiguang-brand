import AsyncStorage from "@react-native-async-storage/async-storage";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { RecipeCover } from "@/components/RecipeCover";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { communityApi, foodsApi, recipesApi, type CommunityPost, type Recipe } from "@/services/api";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { formatLocalPostDate } from "@/utils/postDate";
import { getUserStorageKey, SEARCH_HISTORY_STORAGE_KEY } from "@/utils/userStorage";
import { FoodSourceDetails, type FoodSourceData } from "@/screens/search/FoodSourceDetails";

const MAX_HISTORY_ITEMS = 8;
const POPULAR_SEARCHES = ["高蛋白早餐", "鸡胸肉", "15分钟晚餐", "减脂便当", "燕麦"];

type SearchCategory = "all" | "recipes" | "foods" | "posts" | "users";
type IconName = ComponentProps<typeof FontAwesome6>["name"];

type FoodSearchResult = FoodSourceData & {
  id?: number | string;
  name: string;
  category?: string | null;
  calories_100g: number | null;
  protein_100g: number | null;
  carbs_100g: number | null;
  fat_100g: number | null;
  aliases?: { text: string; language: string; regions: string[] }[];
};

function canPrefillNutrition(food: FoodSearchResult) {
  if (food.source === "concept_base" || food.automatic_calculation_allowed === false) return false;
  if (food.source === "open_api" || food.source_provider === "usda_fdc") return food.nutrition_basis === "per_100g";
  return !food.nutrition_basis || food.nutrition_basis === "per_100g";
}

type UserSearchResult = {
  id: number;
  username: string;
  avatar_url: string | null;
  bio?: string | null;
};

type SearchResults = {
  recipes: Recipe[];
  foods: FoodSearchResult[];
  posts: CommunityPost[];
  users: UserSearchResult[];
};

const EMPTY_RESULTS: SearchResults = { recipes: [], foods: [], posts: [], users: [] };

const CATEGORY_CONFIG: Array<{ key: SearchCategory; label: string; icon: IconName }> = [
  { key: "all", label: "全部", icon: "border-all" },
  { key: "recipes", label: "菜谱", icon: "utensils" },
  { key: "foods", label: "食材", icon: "carrot" },
  { key: "posts", label: "社区", icon: "compass" },
  { key: "users", label: "用户", icon: "user-group" },
];

function SectionHeader({
  title,
  count,
  icon,
  onSeeAll,
}: {
  title: string;
  count: number;
  icon: IconName;
  onSeeAll?: () => void;
}) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-brand/10">
          <FontAwesome6 name={icon} size={11} colorClassName="accent-brand" />
        </View>
        <Text className="text-sm font-black text-ink">{title}</Text>
        <Text className="text-[10px] font-bold text-copy-muted">{count}</Text>
      </View>
      {onSeeAll ? (
        <TouchableOpacity onPress={onSeeAll} className="flex-row items-center gap-1 px-1 py-2">
          <Text className="text-[11px] font-bold text-brand">查看全部</Text>
          <FontAwesome6 name="chevron-right" size={8} colorClassName="accent-brand" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function SearchScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<{ initialQuery?: string }>();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const historyStorageKey = getUserStorageKey(SEARCH_HISTORY_STORAGE_KEY, user?.id);
  const [query, setQuery] = useState(() => params.initialQuery?.trim() || "");
  const [activeCategory, setActiveCategory] = useState<SearchCategory>("all");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!historyStorageKey) {
        if (active) setHistory([]);
        return;
      }
      try {
        const saved = await AsyncStorage.getItem(historyStorageKey);
        const parsed = saved ? JSON.parse(saved) as unknown : [];
        if (active) {
          setHistory(Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_HISTORY_ITEMS)
            : []);
        }
      } catch {
        if (active) setHistory([]);
      }
    })();
    return () => { active = false; };
  }, [historyStorageKey]);

  const commitHistory = useCallback((rawQuery: string) => {
    const value = rawQuery.trim();
    if (!value) return;
    setHistory((current) => {
      const next = [value, ...current.filter((item) => item !== value)].slice(0, MAX_HISTORY_ITEMS);
      if (historyStorageKey) void AsyncStorage.setItem(historyStorageKey, JSON.stringify(next));
      return next;
    });
  }, [historyStorageKey]);

  const performSearch = useCallback(async (rawQuery: string) => {
    const value = rawQuery.trim();
    if (!value) return;

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError(null);

    const encodedQuery = encodeURIComponent(value);
    const [recipeResult, foodResult, postResult, userResult] = await Promise.allSettled([
      recipesApi.listPage<Recipe>(`?search=${encodedQuery}&pageSize=12`),
      foodsApi.search<FoodSearchResult>(value),
      communityApi.posts<CommunityPost>(`?search=${encodedQuery}&limit=12`, authFetch),
      communityApi.users<UserSearchResult>(authFetch, value),
    ]);

    if (requestSequence.current !== sequence) return;

    const nextResults: SearchResults = {
      recipes: recipeResult.status === "fulfilled" ? recipeResult.value.items : [],
      foods: foodResult.status === "fulfilled" ? foodResult.value : [],
      posts: postResult.status === "fulfilled" ? postResult.value : [],
      users: userResult.status === "fulfilled" ? userResult.value : [],
    };
    const failedCount = [recipeResult, foodResult, postResult, userResult]
      .filter((result) => result.status === "rejected").length;

    setResults(nextResults);
    setError(failedCount === 4
      ? "搜索服务暂时不可用，请稍后重试"
      : failedCount > 0
        ? "部分结果暂时未能加载"
        : null);
    setLoading(false);
  }, [authFetch]);

  useEffect(() => {
    const value = query.trim();
    if (!value) return;

    const timer = setTimeout(() => void performSearch(value), 420);
    return () => clearTimeout(timer);
  }, [performSearch, query]);

  const counts = useMemo(() => ({
    all: results.recipes.length + results.foods.length + results.posts.length + results.users.length,
    recipes: results.recipes.length,
    foods: results.foods.length,
    posts: results.posts.length,
    users: results.users.length,
  }), [results]);

  const updateQuery = (value: string) => {
    setQuery(value);
    setActiveCategory("all");
    if (!value.trim()) {
      requestSequence.current += 1;
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setError(null);
    }
  };

  const chooseSuggestion = (value: string) => {
    updateQuery(value);
    commitHistory(value);
  };

  const openRecipe = (recipe: Recipe) => {
    commitHistory(query);
    router.push("/recipe-detail", { id: recipe.id });
  };

  const openFood = (food: FoodSearchResult) => {
    commitHistory(query);
    const nutrition = canPrefillNutrition(food) ? food : null;
    router.push("/diet-record", {
      prefill_food: food.name,
      prefill_amount: "100g",
      prefill_calories: nutrition?.calories_100g ?? '',
      prefill_protein: nutrition?.protein_100g ?? '',
      prefill_carbs: nutrition?.carbs_100g ?? '',
      prefill_fat: nutrition?.fat_100g ?? '',
    });
  };

  const openPost = (post: CommunityPost) => {
    commitHistory(query);
    router.push("/post-detail", { id: post.id, postData: post });
  };

  const openUser = (user: UserSearchResult) => {
    commitHistory(query);
    router.push("/user-profile", { userId: user.id });
  };

  const renderRecipe = (recipe: Recipe) => (
    <TouchableOpacity
      key={recipe.id}
      onPress={() => openRecipe(recipe)}
      accessibilityLabel={`查看菜谱${recipe.title}`}
      className="mb-3 flex-row overflow-hidden rounded-[20px] border border-line bg-surface active:opacity-85"
    >
      <RecipeCover
        uri={recipe.image_url}
        className="h-[94px] w-[104px]"
        placeholderClassName="h-[94px] w-[104px]"
      />
      <View className="min-w-0 flex-1 justify-center px-3.5 py-3">
        <Text className="text-sm font-black text-ink" numberOfLines={1}>{recipe.title}</Text>
        <Text className="mt-1 text-[11px] leading-4 text-copy-muted" numberOfLines={2}>{recipe.description}</Text>
        <View className="mt-2 flex-row items-center gap-3">
          <Text className="text-[10px] font-black text-brand">{recipe.calories == null ? '营养待补全' : `${recipe.calories} kcal`}</Text>
          <Text className="text-[10px] text-copy-muted">{recipe.cook_time == null ? '用时未标注' : `${recipe.cook_time} 分钟`}</Text>
        </View>
      </View>
      <View className="justify-center pr-3">
        <FontAwesome6 name="chevron-right" size={10} colorClassName="accent-copy-muted" />
      </View>
    </TouchableOpacity>
  );

  const renderFood = (food: FoodSearchResult, index: number) => {
    const nutrition = canPrefillNutrition(food) ? food : null;
    return (
    <View
      key={`${food.id ?? food.name}-${index}`}
      className="mb-3 overflow-hidden rounded-[20px] border border-line bg-surface"
    >
    <TouchableOpacity
      onPress={() => openFood(food)}
      accessibilityRole="button"
      accessibilityLabel={`记录食材${food.name}`}
      className="flex-row items-center p-3.5 active:opacity-85"
    >
      <View className="h-12 w-12 items-center justify-center rounded-2xl bg-warm-soft">
        <FontAwesome6 name="leaf" size={17} colorClassName="accent-warm" />
      </View>
      <View className="min-w-0 flex-1 px-3">
        <View className="flex-row items-center gap-2">
          <Text className="shrink text-sm font-black text-ink" numberOfLines={1}>{food.name}</Text>
          <Text className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[8px] font-black text-brand">
            {food.source === "open_api" ? "USDA" : "食材库"}
          </Text>
        </View>
        <Text className="mt-1 text-[10px] text-copy-muted">
          蛋白质 {nutrition?.protein_100g ?? '—'}g · 碳水 {nutrition?.carbs_100g ?? '—'}g · 脂肪 {nutrition?.fat_100g ?? '—'}g
        </Text>
        {food.aliases?.filter(alias => alias.text === query.trim() && alias.regions.length).map(alias => (
          <Text key={`${alias.text}-${alias.regions.join('-')}`} className="mt-1 text-[10px] text-copy-muted">{alias.text} · {alias.regions.join(' / ')}</Text>
        ))}
      </View>
      <View className="items-end">
        <Text className="text-xs font-black text-brand">{nutrition?.calories_100g == null ? '营养待补全' : `${nutrition.calories_100g} kcal`}</Text>
        <Text className="mt-1 text-[9px] text-copy-muted">按 100g 记餐</Text>
      </View>
    </TouchableOpacity>
    <FoodSourceDetails food={food} />
    </View>
    );
  };

  const renderPost = (post: CommunityPost) => (
    <TouchableOpacity
      key={post.id}
      onPress={() => openPost(post)}
      accessibilityLabel={`查看${post.username}的社区动态`}
      className="mb-3 flex-row overflow-hidden rounded-[20px] border border-line bg-surface p-3.5 active:opacity-85"
    >
      <Image source={getAvatarSource(post.avatar_url, post.user_id)} className="h-10 w-10 rounded-full" />
      <View className="min-w-0 flex-1 pl-3">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="shrink text-xs font-black text-ink" numberOfLines={1}>{post.username}</Text>
          <Text className="text-[9px] text-copy-muted">{formatLocalPostDate(post.created_at)}</Text>
        </View>
        <Text className="mt-1.5 text-xs leading-5 text-ink" numberOfLines={2}>{post.content}</Text>
        <View className="mt-2 flex-row items-center gap-1.5">
          <FontAwesome6 name="heart" size={9} colorClassName="accent-copy-muted" />
          <Text className="text-[9px] text-copy-muted">{post.likes_count} 赞</Text>
          {post.category ? <Text className="ml-2 text-[9px] font-bold text-brand">#{post.category}</Text> : null}
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderUser = (user: UserSearchResult) => (
    <TouchableOpacity
      key={user.id}
      onPress={() => openUser(user)}
      accessibilityLabel={`查看用户${user.username}`}
      className="mb-3 flex-row items-center rounded-[20px] border border-line bg-surface p-3.5 active:opacity-85"
    >
      <Image source={getAvatarSource(user.avatar_url, user.id)} className="h-12 w-12 rounded-full" />
      <View className="min-w-0 flex-1 px-3">
        <Text className="text-sm font-black text-ink" numberOfLines={1}>{user.username}</Text>
        <Text className="mt-1 text-[10px] text-copy-muted" numberOfLines={1}>
          {user.bio?.trim() || "正在记录自己的健康食光"}
        </Text>
      </View>
      <View className="rounded-full bg-brand/10 px-3 py-1.5">
        <Text className="text-[10px] font-black text-brand">主页</Text>
      </View>
    </TouchableOpacity>
  );

  const renderSection = (
    category: Exclude<SearchCategory, "all">,
    title: string,
    icon: IconName,
    items: React.ReactNode[],
  ) => {
    const total = counts[category];
    if (!total) return null;
    const visibleItems = activeCategory === "all" ? items.slice(0, 3) : items;
    return (
      <View key={category} className="mb-5">
        <SectionHeader
          title={title}
          count={total}
          icon={icon}
          onSeeAll={activeCategory === "all" && total > 3 ? () => setActiveCategory(category) : undefined}
        />
        {visibleItems}
      </View>
    );
  };

  const hasQuery = query.trim().length > 0;
  const visibleSections = [
    renderSection("recipes", "菜谱", "utensils", results.recipes.map(renderRecipe)),
    renderSection("foods", "食材营养", "carrot", results.foods.map(renderFood)),
    renderSection("posts", "社区动态", "compass", results.posts.map(renderPost)),
    renderSection("users", "食友", "user-group", results.users.map(renderUser)),
  ];

  return (
    <Screen safeAreaEdges={["top", "bottom"]}>
      <View className="border-b border-line bg-canvas px-4 pb-3 pt-2">
        <View className="flex-row items-center gap-2.5">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityLabel="返回"
            className="h-11 w-10 items-center justify-center rounded-full active:bg-brand/10"
          >
            <FontAwesome6 name="arrow-left" size={17} colorClassName="accent-ink" />
          </TouchableOpacity>
          <View className="h-12 flex-1 flex-row items-center rounded-full border border-line bg-surface px-4 shadow-2xs">
            <FontAwesome6 name="magnifying-glass" size={14} colorClassName="accent-brand" />
            <TextInput
              value={query}
              onChangeText={updateQuery}
              onSubmitEditing={() => commitHistory(query)}
              placeholder="搜菜谱、食材、动态或食友"
              placeholderTextColorClassName="accent-copy-muted"
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              className="min-w-0 flex-1 px-3 py-0 text-sm font-medium text-ink"
            />
            {query ? (
              <TouchableOpacity onPress={() => updateQuery("")} accessibilityLabel="清空搜索">
                <FontAwesome6 name="circle-xmark" size={15} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {hasQuery ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingTop: 12, paddingHorizontal: 2 }}
          >
            {CATEGORY_CONFIG.map((category) => {
              const selected = activeCategory === category.key;
              const unavailable = category.key !== "all" && counts[category.key] === 0;
              return (
                <TouchableOpacity
                  key={category.key}
                  onPress={() => setActiveCategory(category.key)}
                  disabled={unavailable}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                    selected ? "border-brand bg-brand-fill" : "border-line bg-surface"
                  } ${unavailable ? "opacity-40" : ""}`}
                >
                  <FontAwesome6 name={category.icon} size={9} colorClassName={selected ? "accent-on-brand" : "accent-copy-muted"} />
                  <Text className={`text-[11px] font-bold ${selected ? "text-white" : "text-copy-muted"}`}>
                    {category.label}{counts[category.key] ? ` ${counts[category.key]}` : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!hasQuery ? (
          <View>
            {history.length ? (
              <View className="mb-8">
                <View className="mb-3 flex-row items-center justify-between">
                  <Text className="text-sm font-black text-ink">最近搜索</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setHistory([]);
                      if (historyStorageKey) void AsyncStorage.removeItem(historyStorageKey);
                    }}
                    className="px-2 py-1"
                  >
                    <Text className="text-[11px] font-bold text-copy-muted">清除</Text>
                  </TouchableOpacity>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {history.map((item) => (
                    <TouchableOpacity
                      key={item}
                      onPress={() => chooseSuggestion(item)}
                      className="flex-row items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2"
                    >
                      <FontAwesome6 name="clock-rotate-left" size={9} colorClassName="accent-copy-muted" />
                      <Text className="text-xs font-semibold text-ink">{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <View className="mb-5">
              <Text className="mb-3 text-sm font-black text-ink">大家常搜</Text>
              <View className="flex-row flex-wrap gap-2">
                {POPULAR_SEARCHES.map((item, index) => (
                  <TouchableOpacity
                    key={item}
                    onPress={() => chooseSuggestion(item)}
                    className="flex-row items-center gap-1.5 rounded-full bg-brand/10 px-3 py-2"
                  >
                    {index < 3 ? <FontAwesome6 name="arrow-trend-up" size={9} colorClassName="accent-brand" /> : null}
                    <Text className="text-xs font-bold text-brand">{item}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View className="mt-4 overflow-hidden rounded-[26px] border border-brand/10 bg-brand-fill p-5">
              <View className="h-10 w-10 items-center justify-center rounded-2xl bg-surface/15">
                <FontAwesome6 name="wand-magic-sparkles" size={15} colorClassName="accent-on-brand" />
              </View>
              <Text className="mt-4 text-lg font-black text-white">一次搜索，找到完整答案</Text>
              <Text className="mt-2 text-xs leading-5 text-white/75">
                从可做菜谱到食材营养，再到食友分享，结果会按类型整理好。
              </Text>
            </View>
          </View>
        ) : loading ? (
          <View className="items-center py-24">
            <ActivityIndicator size="large" colorClassName="accent-brand" />
            <Text className="mt-4 text-xs font-medium text-copy-muted">正在整理相关结果…</Text>
          </View>
        ) : error && counts.all === 0 ? (
          <View className="items-center py-20">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-warm-soft">
              <FontAwesome6 name="wifi" size={21} colorClassName="accent-warm" />
            </View>
            <Text className="mt-5 text-base font-black text-ink">搜索暂时没有响应</Text>
            <Text className="mt-2 text-center text-xs leading-5 text-copy-muted">{error}</Text>
            <TouchableOpacity
              onPress={() => void performSearch(query)}
              className="mt-6 rounded-full bg-brand-fill px-5 py-3"
            >
              <Text className="text-xs font-black text-white">重新搜索</Text>
            </TouchableOpacity>
          </View>
        ) : counts.all === 0 ? (
          <View className="items-center py-20">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-brand/10">
              <FontAwesome6 name="magnifying-glass" size={22} colorClassName="accent-brand" />
            </View>
            <Text className="mt-5 text-base font-black text-ink">没有找到“{query.trim()}”</Text>
            <Text className="mt-2 max-w-[280px] text-center text-xs leading-5 text-copy-muted">
              试试更短的关键词，或者提交新的食材营养信息。
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/custom-food")}
              className="mt-6 flex-row items-center gap-2 rounded-full bg-brand-fill px-5 py-3"
            >
              <FontAwesome6 name="plus" size={11} colorClassName="accent-on-brand" />
              <Text className="text-xs font-black text-white">添加新食材</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            {error ? (
              <TouchableOpacity
                onPress={() => void performSearch(query)}
                className="mb-4 rounded-2xl border border-warm/30 bg-warm-soft p-3"
              >
                <Text className="text-xs font-bold text-warm">{error} · 点击重试</Text>
              </TouchableOpacity>
            ) : null}
            <Text className="mb-5 text-xs text-copy-muted">
              找到 <Text className="font-black text-brand">{counts.all}</Text> 条与“{query.trim()}”相关的结果
            </Text>
            {activeCategory === "all"
              ? visibleSections
              : visibleSections.filter((_, index) => CATEGORY_CONFIG[index + 1]?.key === activeCategory)}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
