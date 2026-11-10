import { resolveMediaUrl } from "@/utils/mediaUrl";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Animated,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  Platform,
  Easing,
  PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/components/Screen";
import { useFocusEffect } from "expo-router";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { RecipeCover } from "@/components/RecipeCover";
import { toLocalDateKey } from "@/utils/date";
import { getUserStorageKey, SHOPPING_LIST_STORAGE_KEY } from "@/utils/userStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { daysUntilDateKey, groupInventoryByStorage, getInventoryStorageDisplay, formatInventoryQuantity } from "@/utils/inventory";
import { aiApi, cookingQueueApi, recommendationsApi, recipesApi, type RecipeRecommendationItem, type RecipeRecommendationPage } from "@/services/api";
import type { InventoryHighlight, RankedRecipe, RecommendationCard, Recipe } from "./types";
import { formatRecommendationMetric, getRecommendationPeriod } from "./recommendations";
import { useHomeData } from "./useHomeData";
import { useHealthSummary } from "@/hooks/useHealthSummary";
import { OnboardingProgressCard } from "@/components/OnboardingProgressCard";
import { TodayRecordsModal } from "./TodayRecordsModal";
import { formatNutritionSummary, summarizeNutrition } from "@/utils/nutritionSummary";
import { getHorizontalSwipeDirection } from "./carousel";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const RECIPE_BATCH_SIZE = 3;

export default function HomeScreen() {
  const { user, sessionGeneration } = useAuth();
  return <HomeContent key={`${user?.id ?? "guest"}:${sessionGeneration}`} />;
}

function HomeContent() {
  const router = useSafeRouter();
  const { isAuthenticated, user } = useAuth();
  const userId = user?.id;
  const authFetch = useAuthFetch();
  const { profile: healthProfile, targetCalories, targetLabel } = useHealthSummary();

  const [activeCategory, setActiveCategory] = useState("全部");
  const [visibleRecipeCount, setVisibleRecipeCount] = useState(RECIPE_BATCH_SIZE);
  const lastRecipeBatchLoadAt = useRef(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [allRecordsModalVisible, setAllRecordsModalVisible] = useState(false);
  const [aiRecCards, setAiRecCards] = useState<RecommendationCard[]>([]);
  const [homeRecommendationItems, setHomeRecommendationItems] = useState<Array<RecipeRecommendationItem<Recipe>>>([]);
  const [homeRecommendationRequestId, setHomeRecommendationRequestId] = useState<string | null>(null);
  const [homeRecommendationVersion, setHomeRecommendationVersion] = useState("");
  const aiRecommendationRequestKey = useRef("");
  const [activeRecommendationCard, setActiveRecommendationCard] = useState(0);
  const [smartFeedOffset] = useState(() => new Animated.Value(0));
  const [smartFeedOpacity] = useState(() => new Animated.Value(1));
  const smartFeedLastInteractionAt = useRef(0);
  const smartFeedAnimating = useRef(false);
  const [activeInventoryHighlight, setActiveInventoryHighlight] = useState(0);
  const [inventoryHighlightOffset] = useState(() => new Animated.Value(0));
  const [inventoryHighlightOpacity] = useState(() => new Animated.Value(1));
  const [activeCommunityPost, setActiveCommunityPost] = useState(0);
  const [communityPostOffset] = useState(() => new Animated.Value(0));
  const [communityPostOpacity] = useState(() => new Animated.Value(1));
  const [activeCaloriePanel, setActiveCaloriePanel] = useState(0);
  const [caloriePanelOffset] = useState(() => new Animated.Value(0));
  const [caloriePanelOpacity] = useState(() => new Animated.Value(1));
  const [calorieProgress] = useState(() => new Animated.Value(0));

  const categories = ["全部", "减脂", "增肌", "营养餐单"];
  const today = toLocalDateKey();
  const { recipes, inventoryItems, expiringItems, todayRecords, posts, healthLogs, loading, error, refresh } =
    useHomeData(authFetch, isAuthenticated, today);

  const shoppingStorageKey = getUserStorageKey(SHOPPING_LIST_STORAGE_KEY, userId);
  const [shoppingItems, setShoppingItems] = useState<{ id: string; name: string; amount: string; checked: boolean }[]>([]);
  const [cookingQueueCount, setCookingQueueCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setVisibleRecipeCount(RECIPE_BATCH_SIZE);
      lastRecipeBatchLoadAt.current = 0;
      void refresh();
      let active = true;

      if (shoppingStorageKey) {
        AsyncStorage.getItem(shoppingStorageKey).then((saved) => {
          if (!active) return;
          if (saved) {
            try {
              setShoppingItems(JSON.parse(saved));
            } catch {}
          } else setShoppingItems([]);
        }).catch(() => { if (active) setShoppingItems([]); });
      } else setShoppingItems([]);

      if (userId) {
        void cookingQueueApi.list(authFetch)
          .then((items) => { if (active) setCookingQueueCount(items.length); })
          .catch(() => { if (active) setCookingQueueCount(0); });
      } else setCookingQueueCount(0);
      return () => { active = false; };
    }, [authFetch, refresh, shoppingStorageKey, userId])
  );

  const calories = summarizeNutrition(todayRecords.map(record => record.calories));
  const protein = summarizeNutrition(todayRecords.map(record => record.protein));
  const carbs = summarizeNutrition(todayRecords.map(record => record.carbs));
  const fat = summarizeNutrition(todayRecords.map(record => record.fat));
  const totalCalories = calories.total;
  const totalProtein = protein.total;
  const calorieLabel = todayRecords.length === 0 ? "今日尚未记录饮食"
    : totalCalories == null ? "今日热量未知"
    : `${calories.incomplete ? "今日已知热量" : "今日已记录"} ${totalCalories} kcal`;
  const calPercent = totalCalories == null || calories.incomplete ? null
    : Math.min(Math.round((totalCalories / targetCalories) * 100), 100);
  const todayWaterMl = healthLogs.find((log) => log.recorded_date === today)?.water_ml || 0;
  const priorityInventoryItem = expiringItems[0];
  const priorityExpiryDays = priorityInventoryItem
    ? Math.max(0, daysUntilDateKey(priorityInventoryItem.expiration_date) ?? 0)
    : null;
  const storageGroups = groupInventoryByStorage(inventoryItems);
  const inventoryHighlights: InventoryHighlight[] = [
    ...(priorityInventoryItem ? [{
      eyebrow: "今日优先消耗",
      title: priorityInventoryItem.food_name,
      description: `剩余 ${formatInventoryQuantity(priorityInventoryItem.quantity)} · ${priorityExpiryDays === 0 ? "今天到期" : `还剩 ${priorityExpiryDays} 天`}`,
      icon: "carrot" as const,
      tone: "amber" as const,
      prompt: `我的【${priorityInventoryItem.food_name}】还剩${formatInventoryQuantity(priorityInventoryItem.quantity)}，${priorityExpiryDays === 0 ? "今天到期" : `还剩${priorityExpiryDays}天到期`}。请优先用它做一份简单健康的消耗餐。`,
    }] : []),
    ...(inventoryItems.length > 0 ? [{
      eyebrow: "库存分布",
      title: `冷藏 ${storageGroups.冷藏.length} · 冷冻 ${storageGroups.冷冻.length} · 常温 ${storageGroups.常温.length} · 位置待确认 ${storageGroups.位置待确认.length}`,
      description: `当前共 ${inventoryItems.length} 种食材，随时可以开始配餐`,
      icon: "boxes-stacked" as const,
      tone: "green" as const,
    }, {
      eyebrow: "最新备货",
      title: inventoryItems[0]?.food_name || "食材已更新",
      description: `${getInventoryStorageDisplay(inventoryItems[0]?.storage_location)} · ${formatInventoryQuantity(inventoryItems[0]?.quantity)}，已加入你的保鲜库`,
      icon: "basket-shopping" as const,
      tone: "green" as const,
    }] : [{
      eyebrow: "开始整理保鲜库",
      title: "还没有记录食材",
      description: "添加食材后，系统会为你安排临期提醒和配餐建议",
      icon: "plus" as const,
      tone: "green" as const,
    }]),
  ];
  const activeInventoryCard = inventoryHighlights[activeInventoryHighlight] || inventoryHighlights[0];
  const communityPosts = posts.slice(0, 5);
  const featuredCommunityPost = communityPosts[activeCommunityPost] || communityPosts[0];
  const currentRecommendationHour = new Date().getHours();
  const mealRecommendationCount = aiRecCards.length || (currentRecommendationHour >= 22 || currentRecommendationHour < 5 ? 1 : 2);
  const smartFeedCardCount = mealRecommendationCount + 1 + (expiringItems.length > 0 ? 1 : 0) + (todayWaterMl < 1600 ? 1 : 0);

  const changeSmartFeedCard = useCallback((direction: "prev" | "next") => {
    if (smartFeedCardCount < 2 || smartFeedAnimating.current) return;

    smartFeedAnimating.current = true;
    const exitOffset = direction === "next" ? -28 : 28;
    const enterOffset = -exitOffset;

    Animated.parallel([
      Animated.timing(smartFeedOffset, {
        toValue: exitOffset,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(smartFeedOpacity, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (!finished) {
        smartFeedAnimating.current = false;
        return;
      }

      setActiveRecommendationCard((current) =>
        direction === "next"
          ? (current + 1) % smartFeedCardCount
          : (current - 1 + smartFeedCardCount) % smartFeedCardCount
      );
      smartFeedOffset.setValue(enterOffset);

      Animated.parallel([
        Animated.timing(smartFeedOffset, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(smartFeedOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ]).start(() => {
        smartFeedAnimating.current = false;
      });
    });
  }, [smartFeedCardCount, smartFeedOffset, smartFeedOpacity]);

  useEffect(() => {
    smartFeedOffset.setValue(0);
    smartFeedOpacity.setValue(1);
    smartFeedAnimating.current = false;
    if (smartFeedCardCount < 2) return;

    const intervalId = setInterval(() => {
      if (Date.now() - smartFeedLastInteractionAt.current >= 3_200) {
        changeSmartFeedCard("next");
      }
    }, 4500);
    return () => clearInterval(intervalId);
  }, [changeSmartFeedCard, smartFeedCardCount, smartFeedOffset, smartFeedOpacity]);

  const smartFeedPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      getHorizontalSwipeDirection(gesture.dx, gesture.dy, 12) !== null,
    onPanResponderRelease: (_event, gesture) => {
      const direction = getHorizontalSwipeDirection(gesture.dx, gesture.dy);
      if (!direction) return;
      smartFeedLastInteractionAt.current = Date.now();
      changeSmartFeedCard(direction);
    },
    onPanResponderTerminationRequest: () => true,
  }), [changeSmartFeedCard]);

  useEffect(() => {
    Animated.timing(calorieProgress, {
      toValue: calPercent ?? 0,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [calPercent, calorieProgress]);

  useEffect(() => {
    let panelIndex = 0;
    const intervalId = setInterval(() => {
      panelIndex = (panelIndex + 1) % 3;
      Animated.parallel([
        Animated.timing(caloriePanelOffset, {
          toValue: -8,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(caloriePanelOpacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: false,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setActiveCaloriePanel(panelIndex);
        caloriePanelOffset.setValue(8);
        Animated.parallel([
          Animated.timing(caloriePanelOffset, {
            toValue: 0,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(caloriePanelOpacity, {
            toValue: 1,
            duration: 240,
            useNativeDriver: false,
          }),
        ]).start();
      });
    }, 3800);

    return () => clearInterval(intervalId);
  }, [caloriePanelOffset, caloriePanelOpacity]);

  useEffect(() => {
    inventoryHighlightOffset.setValue(0);
    inventoryHighlightOpacity.setValue(1);
    if (inventoryHighlights.length < 2) return;

    let highlightIndex = 0;
    const intervalId = setInterval(() => {
      highlightIndex = (highlightIndex + 1) % inventoryHighlights.length;
      Animated.parallel([
        Animated.timing(inventoryHighlightOffset, { toValue: -10, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(inventoryHighlightOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setActiveInventoryHighlight(highlightIndex);
        inventoryHighlightOffset.setValue(10);
        Animated.parallel([
          Animated.timing(inventoryHighlightOffset, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
          Animated.timing(inventoryHighlightOpacity, { toValue: 1, duration: 280, useNativeDriver: false }),
        ]).start();
      });
    }, 4200);
    return () => clearInterval(intervalId);
  }, [inventoryHighlightOffset, inventoryHighlightOpacity, inventoryHighlights.length]);

  useEffect(() => {
    communityPostOffset.setValue(0);
    communityPostOpacity.setValue(1);
    if (communityPosts.length < 2) return;

    let postIndex = 0;
    const intervalId = setInterval(() => {
      postIndex = (postIndex + 1) % communityPosts.length;
      Animated.parallel([
        Animated.timing(communityPostOffset, { toValue: -10, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(communityPostOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setActiveCommunityPost(postIndex);
        communityPostOffset.setValue(10);
        Animated.parallel([
          Animated.timing(communityPostOffset, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
          Animated.timing(communityPostOpacity, { toValue: 1, duration: 280, useNativeDriver: false }),
        ]).start();
      });
    }, 5000);
    return () => clearInterval(intervalId);
  }, [communityPostOffset, communityPostOpacity, communityPosts.length]);

  useEffect(() => {
    if (!isAuthenticated || loading) return;

    const period = getRecommendationPeriod(new Date().getHours());
    const requestKey = `${period}:${targetCalories}:${totalCalories}:${totalProtein}:${calories.incomplete}:${protein.incomplete}:${inventoryItems.map((item) => `${item.id}-${item.expiration_date}`).join(",")}`;
    if (aiRecommendationRequestKey.current === requestKey) return;
    aiRecommendationRequestKey.current = requestKey;

    let active = true;
    const fetchAIRecommendations = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const data = await aiApi.homeRecommendations<{
          cards?: unknown[];
          recommendations?: RecipeRecommendationPage<Recipe>;
        }>(authFetch, period, requestKey, controller.signal);
        const cards: RecommendationCard[] = Array.isArray(data.cards)
          ? data.cards
            .filter((card: unknown): card is Record<string, unknown> => !!card && typeof card === "object")
            .map((card: Record<string, unknown>): RecommendationCard => ({
              recipeId: Number.isInteger(Number(card.recipeId)) ? Number(card.recipeId) : undefined,
              title: typeof card.title === "string" ? card.title : "",
              tag: typeof card.tag === "string" ? card.tag : "",
              desc: typeof card.desc === "string" ? card.desc : "",
              calories: formatRecommendationMetric(card),
              prompt: typeof card.prompt === "string" ? card.prompt : "",
            }))
            .filter((card: RecommendationCard) => card.title && card.tag && card.desc && card.prompt)
            .slice(0, 5)
          : [];
        if (active && cards.length > 0) setAiRecCards(cards);
        if (active && data.recommendations) {
          setHomeRecommendationItems(data.recommendations.items);
          setHomeRecommendationRequestId(data.recommendations.requestId);
          setHomeRecommendationVersion(data.recommendations.scoringVersion);
          void Promise.all(data.recommendations.items.map((item) => recommendationsApi.event(authFetch, {
            requestId: data.recommendations!.requestId,
            recipeId: item.recipeId,
            eventType: "exposure",
            scoringVersion: data.recommendations!.scoringVersion,
            surface: "home",
            idempotencyKey: `home-exposure-${data.recommendations!.requestId}-${item.recipeId}`,
          }).catch(() => undefined)));
        }
      } catch (error) {
        // 首页保留时段默认卡片，AI 服务不可用或超时时不影响页面使用。
        console.warn("Home AI recommendations unavailable or timed out", error);
      } finally {
        clearTimeout(timer);
      }
    };

    void fetchAIRecommendations();
    return () => { active = false; };
  }, [authFetch, inventoryItems, isAuthenticated, loading, targetCalories, totalCalories, totalProtein, calories.incomplete, protein.incomplete]);

  const filteredRecipes = useMemo<RankedRecipe[]>(() => {
    if (isAuthenticated) {
      return homeRecommendationItems
        .filter((item) => activeCategory === "全部" || item.recipe.category === activeCategory)
        .map((item) => ({
          ...item.recipe,
          inventoryMatchNames: item.features.matchedIngredients.map((ingredient) => ingredient.name),
          expiringMatchCount: item.features.expiringIngredients.length,
        }));
    }
    const availableInventory = inventoryItems.filter((item) => item.is_available && item.food_name.trim());
    const expiringIds = new Set(expiringItems.map((item) => item.id));

    return recipes
      .filter((recipe) => {
        if (recipe.quality_status === "needs_review") return false;
        const matchCategory = activeCategory === "全部" || recipe.category === activeCategory;
        return matchCategory;
      })
      .map((recipe) => {
        const recipeIngredientNames = (recipe.ingredients || [])
          .map((ingredient) => typeof ingredient === "string" ? ingredient : ingredient.name || "")
          .filter(Boolean);
        const matchedItems = availableInventory.filter((item) =>
          recipeIngredientNames.some((ingredientName) => ingredientName.includes(item.food_name) || item.food_name.includes(ingredientName))
        );

        return {
          ...recipe,
          inventoryMatchNames: [...new Set(matchedItems.map((item) => item.food_name))],
          expiringMatchCount: matchedItems.filter((item) => expiringIds.has(item.id)).length,
        };
      })
      .sort((left, right) => {
        if (right.expiringMatchCount !== left.expiringMatchCount) {
          return right.expiringMatchCount - left.expiringMatchCount;
        }
        if (right.inventoryMatchNames.length !== left.inventoryMatchNames.length) {
          return right.inventoryMatchNames.length - left.inventoryMatchNames.length;
        }
        return right.id - left.id;
      });
  }, [activeCategory, expiringItems, homeRecommendationItems, inventoryItems, isAuthenticated, recipes]);

  const visibleRecipes = filteredRecipes.slice(0, visibleRecipeCount);
  const hasMoreRecipes = visibleRecipeCount < filteredRecipes.length;

  useEffect(() => {
    const resetId = setTimeout(() => {
      setVisibleRecipeCount(RECIPE_BATCH_SIZE);
      lastRecipeBatchLoadAt.current = 0;
    }, 0);
    return () => clearTimeout(resetId);
  }, [activeCategory]);

  const insets = useSafeAreaInsets();
  const miniTopOffset = Platform.OS === 'web' ? 12 : Math.max(insets.top + 6, 12);

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      {/* 渐隐渐现 极致悬浮 Mini 胶囊顶栏 */}
      {isScrolled && (
        <View style={{ top: miniTopOffset }} className="absolute left-4 right-4 z-50">
          <View className="bg-surface/95 px-4 py-2 rounded-full flex-row items-center justify-between shadow-lg border border-line backdrop-blur-md">
            <View className="bg-brand/10 px-2.5 py-1 rounded-full flex-row items-center gap-1">
              <FontAwesome6 name="fire-flame-curved" size={11} colorClassName="accent-brand" />
              <Text className="text-xs font-black text-brand">
                {calorieLabel}
              </Text>
            </View>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity onPress={() => router.push(isAuthenticated ? "/profile" : "/login")}>
                {isAuthenticated ? (
                  <Image
                    source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
                    className="w-7 h-7 rounded-full border border-brand"
                    style={{ width: 28, height: 28, borderRadius: 14 }}
                  />
                ) : (
                  <View className="w-7 h-7 rounded-full bg-brand/15 items-center justify-center">
                    <FontAwesome6 name="user" size={10} colorClassName="accent-brand" />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const offsetY = contentOffset.y;
          if (offsetY > 70 && !isScrolled) setIsScrolled(true);
          else if (offsetY <= 70 && isScrolled) setIsScrolled(false);

          const distanceFromBottom = contentSize.height - layoutMeasurement.height - offsetY;
          const now = Date.now();
          if (hasMoreRecipes && distanceFromBottom < 280 && now - lastRecipeBatchLoadAt.current > 450) {
            lastRecipeBatchLoadAt.current = now;
            setVisibleRecipeCount((count) =>
              Math.min(count + RECIPE_BATCH_SIZE, filteredRecipes.length)
            );
          }
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 120 }}
        className="bg-canvas"
      >
        {/* 首页工具栏：搜索、烹饪队列与 AI 配餐。 */}
        <View className="px-5 pt-3"><OnboardingProgressCard /></View>
        <View className="bg-canvas px-5 pt-3 pb-1">
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => router.push("/search")}
              accessibilityRole="button"
              accessibilityLabel="打开全局搜索"
              className="h-11 flex-1 flex-row items-center gap-2 rounded-full border border-line bg-surface px-4 shadow-2xs active:opacity-85"
            >
              <FontAwesome6 name="magnifying-glass" size={13} colorClassName="accent-brand" />
              <Text className="min-w-0 flex-1 text-xs font-medium text-copy-muted">
                搜菜谱、食材、动态或食友
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/cooking-queue")}
              accessibilityRole="button"
              accessibilityLabel={cookingQueueCount ? `烹饪队列，有 ${cookingQueueCount} 道待做` : "打开烹饪队列"}
              className="relative h-11 flex-row items-center gap-1.5 rounded-full border border-line bg-surface px-3 shadow-2xs active:opacity-85"
            >
              <FontAwesome6 name="list-check" size={12} colorClassName="accent-brand" />
              <Text className="text-[11px] font-black text-brand">队列</Text>
              {cookingQueueCount ? (
                <View className="absolute -right-1.5 -top-1.5 min-w-5 items-center justify-center rounded-full border-2 border-canvas bg-warm-fill px-1 py-0.5">
                  <Text className="text-[8px] font-black text-white">{cookingQueueCount > 99 ? "99+" : cookingQueueCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/ai-assistant")}
              accessibilityRole="button"
              accessibilityLabel="打开食语 AI 配餐"
              className="h-11 flex-row items-center gap-1.5 rounded-full bg-brand-fill px-4 shadow-xs active:opacity-90"
            >
              <FontAwesome6 name="wand-magic-sparkles" size={12} colorClassName="accent-on-brand" />
              <Text className="text-xs font-black text-white">配餐</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error ? (
          <TouchableOpacity onPress={() => void refresh()} className="mx-5 mt-3 rounded-2xl border border-critical/40 bg-danger-soft p-3">
            <Text className="text-xs font-bold text-critical">{error} · 点击重试</Text>
          </TouchableOpacity>
        ) : null}

        {/* ⏰ 时段智能推荐轮播卡片 (Time-Aware Carousel) */}
        {(() => {
          const hour = new Date().getHours();
          let periodTitle = "早餐吃什么";
          let recCards: RecommendationCard[] = [
            {
              title: "燕麦水煮蛋能量碗",
              tag: "高蛋白",
              desc: "优质碳水结合蛋白质，饱腹持久不升糖",
              calories: "320 kcal",
              prompt: "帮我评估早餐吃燕麦水煮蛋的营养比例",
            },
            {
              title: "保鲜库牛油果全麦吐司",
              tag: "优质脂肪",
              desc: "用保鲜库现有牛油果涂抹全麦面包",
              calories: "280 kcal",
              prompt: "用保鲜库牛油果推荐一份15分钟快手早餐",
            },
          ];

          if (hour >= 11 && hour < 14) {
            periodTitle = "午餐吃什么";
            recCards = [
              {
                title: "鸡胸肉藜麦牛油果沙拉",
                tag: "低脂减脂",
                desc: "煎鸡胸肉配新鲜蔬菜，补充优质蛋白",
                calories: "420 kcal",
                prompt: "帮我用保鲜库鸡胸肉做一份低卡减脂午餐食谱",
              },
              {
                title: "清蒸鲈鱼配杂粮饭",
                tag: "易消化",
                desc: "优质白肉蛋白，补充丰富微量元素",
                calories: "450 kcal",
                prompt: "推荐一份适合工作日的低脂快手午餐",
              },
            ];
          } else if (hour >= 14 && hour < 18) {
            periodTitle = "下午加餐";
            recCards = [
              {
                title: "希腊酸奶配一把坚果",
                tag: "低糖高纤",
                desc: "替代高糖奶茶，稳定血糖与注意力",
                calories: "160 kcal",
                prompt: "推荐几款低于200卡路里的健康下午茶替代品",
              },
              {
                title: "无糖黑咖啡配水蜜桃",
                tag: "去水肿",
                desc: "促进代谢，帮助下半场恢复精力",
                calories: "80 kcal",
                prompt: "下午茶想吃甜食有什么低卡解馋选择",
              },
            ];
          } else if (hour >= 18 && hour < 22) {
            periodTitle = "今晚吃什么";
            recCards = [
              {
                title: "蒜蓉炒鸡胸肉配水煮西蓝花",
                tag: "夜间修护",
                desc: "保鲜库鸡胸肉少油清炒，减轻肠胃负担",
                calories: "310 kcal",
                prompt: "帮我规划明天一整天的健康减脂一日三餐食谱",
              },
              {
                title: "菌菇豆腐清汤",
                tag: "暖胃低热",
                desc: "低卡丰富鲜味，防止夜间高盐浮肿",
                calories: "180 kcal",
                prompt: "晚餐想吃热乎乎的低卡汤品有什么推荐",
              },
            ];
          } else if (hour >= 22 || hour < 5) {
            periodTitle = "深夜有点饿？";
            recCards = [
              {
                title: "暖洋甘菊茶 / 温无糖牛奶",
                tag: "助眠安神",
                desc: "温暖胃部，促进睡眠，告别失眠与肚饿",
                calories: "110 kcal",
                prompt: "深夜有点饿有什么不会发胖的健康食物",
              },
            ];
          }

          if (aiRecCards.length > 0) {
            recCards = aiRecCards;
          }

          const smartCards: Array<RecommendationCard & { headerTitle: string; actionLabel: string }> = [
            ...recCards.map((card) => ({
              ...card,
              headerTitle: periodTitle,
              actionLabel: card.recipeId ? "查看安全菜谱" : "让食语生成食谱",
            })),
            ...(expiringItems.length > 0 ? [{
              title: `${expiringItems.length} 件食材临近到期`,
              tag: "临期提醒",
              desc: `优先消耗 ${expiringItems.slice(0, 2).map((item) => item.food_name).join("、")}${expiringItems.length > 2 ? " 等食材" : ""}`,
              calories: "优先处理",
              prompt: `我有${expiringItems.length}件临期食材：${expiringItems.map((item) => item.food_name).join("、")}。请优先用它们安排一份容易完成的餐食。`,
              headerTitle: "临期食材提醒",
              actionLabel: "安排消耗方案",
            }] : []),
            {
              title: calorieLabel,
              tag: "热量进度",
              desc: calPercent == null
                ? `${targetLabel} ${targetCalories} kcal；${todayRecords.length ? "记录中有热量待补全，暂不计算进度" : "记录第一餐后查看进度"}`
                : totalCalories! >= targetCalories
                ? "已接近今日目标，接下来优先选择清淡低热量食物"
                : `${targetLabel} ${targetCalories} kcal，已记录 ${totalCalories} kcal`,
              calories: calPercent == null ? "待补全" : `${calPercent}%`,
              prompt: `${calorieLabel}。${calories.incomplete ? "部分餐次热量未知，不要将已知小计当作全天总量。" : ""}${targetLabel}为${targetCalories} kcal。请根据我现有库存规划今天接下来的饮食，不要把系统参考值当成我确认的目标。`,
              headerTitle: "今日饮食进度",
              actionLabel: "规划下一餐",
            },
            ...(todayWaterMl < 1600 ? [{
              title: `今日饮水 ${todayWaterMl} / 2000 ml`,
              tag: "补水提醒",
              desc: todayWaterMl === 0 ? "今天还没有记录饮水，先喝一杯温水吧" : "距离建议饮水量还有一点差距，记得分次补足",
              calories: `${Math.max(0, 2000 - todayWaterMl)} ml`,
              prompt: `我今天已饮水${todayWaterMl} ml。请给我一个不影响睡眠和用餐的补水计划。`,
              headerTitle: "今日补水提醒",
              actionLabel: "制定补水计划",
            }] : []),
          ];
          const visibleSmartCardIndex = Math.min(activeRecommendationCard, smartCards.length - 1);
          const activeSmartCard = smartCards[visibleSmartCardIndex] || smartCards[0];

          return (
            <View className="px-5 mt-3 mb-4">
              <Animated.View
                accessibilityHint={smartCards.length > 1 ? "左右滑动可切换推荐卡片" : undefined}
                {...smartFeedPanResponder.panHandlers}
                style={{
                  minHeight: 184,
                  opacity: smartFeedOpacity,
                  transform: [{ translateX: smartFeedOffset }],
                }}
                className="overflow-hidden rounded-[28px] border border-line bg-brand-soft p-5"
              >
                <View className="mb-4 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <View className="h-7 w-7 items-center justify-center rounded-xl bg-brand-fill">
                      <FontAwesome6 name="wand-magic-sparkles" size={10} colorClassName="accent-on-brand" />
                    </View>
                    <Text className="text-sm font-black text-ink">{activeSmartCard.headerTitle}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-[10px] font-bold text-brand">食语推荐</Text>
                    <Text className="mt-0.5 text-[9px] font-black text-copy-muted">
                      {visibleSmartCardIndex + 1} / {smartCards.length}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                    onPress={() => {
                      if (activeSmartCard.recipeId) {
                        if (homeRecommendationRequestId) {
                          void recommendationsApi.event(authFetch, {
                            requestId: homeRecommendationRequestId,
                            recipeId: activeSmartCard.recipeId,
                            eventType: "view",
                            scoringVersion: homeRecommendationVersion,
                            surface: "home",
                            idempotencyKey: `home-view-${homeRecommendationRequestId}-${activeSmartCard.recipeId}`,
                          }).catch(() => undefined);
                        }
                        router.push("/recipe-detail", { id: activeSmartCard.recipeId, recommendationRequestId: homeRecommendationRequestId ?? undefined });
                        return;
                      }
                      router.push({
                        pathname: "/ai-assistant",
                        params: { prefill_food: activeSmartCard.title, prompt: activeSmartCard.prompt },
                      });
                    }}
                    className="active:opacity-80"
                  >
                    <View className="mb-2.5 flex-row items-center gap-2">
                      <View className="rounded-full bg-surface/75 px-2.5 py-1">
                        <Text className="text-[10px] font-bold text-brand">{activeSmartCard.tag}</Text>
                      </View>
                      <Text className="text-[10px] font-black text-warm">{activeSmartCard.calories}</Text>
                    </View>
                    <Text className="text-[17px] font-black leading-6 text-ink">{activeSmartCard.title}</Text>
                    <Text className="mt-1 text-[11px] leading-4 text-copy-muted" numberOfLines={1}>
                      {activeSmartCard.desc}
                    </Text>
                    <View className="mt-4 flex-row items-center justify-between">
                      {smartCards.length > 1 ? (
                        <View className="flex-row items-center gap-1.5">
                          {smartCards.map((_, index) => (
                            <View
                              key={index}
                              className={`h-1.5 rounded-full ${visibleSmartCardIndex === index ? "w-4 bg-brand-fill" : "w-1.5 bg-brand/20"}`}
                            />
                          ))}
                        </View>
                      ) : <View />}
                      <View className="flex-row items-center rounded-full bg-brand-fill px-4 py-2">
                        <Text className="text-[11px] font-black text-white">{activeSmartCard.actionLabel}</Text>
                        <FontAwesome6 name="arrow-right" size={9} colorClassName="accent-on-brand" style={{ marginLeft: 6 }} />
                      </View>
                    </View>
                  </TouchableOpacity>

                <View className="mt-3 flex-row items-start border-t border-brand/10 pt-2.5">
                  <FontAwesome6 name="circle-info" size={9} colorClassName="accent-copy-muted" style={{ marginTop: 2 }} />
                  <Text className="ml-1.5 flex-1 text-[9px] leading-3.5 text-copy-muted" numberOfLines={2}>
                    AI 营养估算仅供日常健康管理，不构成医疗诊断或治疗建议。
                  </Text>
                </View>
              </Animated.View>
            </View>
          );
        })()}

        {/* 卡路里 & 三大营养素 Dashboard 卡片 */}
        <View className="px-5 mb-5">
          <View className="bg-surface rounded-[24px] p-4 border border-line shadow-xs overflow-hidden relative">
            <View className="absolute -right-8 -top-12 w-32 h-32 rounded-full bg-brand/5" />
            {todayRecords.length === 0 ? (
              <View>
                <View className="flex-row items-center">
                  <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand/10">
                    <FontAwesome6 name="bowl-food" size={16} colorClassName="accent-brand" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-sm font-black text-ink">今天还没记录饮食</Text>
                    <Text className="mt-1 text-[10px] leading-4 text-copy-muted">记下第一餐后，这里会显示热量与营养趋势</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.push("/diet-record")}
                    className="ml-3 flex-row items-center rounded-full bg-brand-fill px-3.5 py-2 active:opacity-80"
                  >
                    <FontAwesome6 name="plus" size={10} colorClassName="accent-on-brand" />
                    <Text className="ml-1.5 text-[11px] font-black text-white">记一餐</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => router.push("/health-data")}
                  className="mt-3 flex-row items-center justify-center border-t border-line pt-3"
                >
                  <FontAwesome6 name="heart-pulse" size={10} colorClassName="accent-brand" />
                  <Text className="ml-1.5 text-[10px] font-bold text-brand">查看健康档案</Text>
                  <FontAwesome6 name="chevron-right" size={8} colorClassName="accent-brand" style={{ marginLeft: 5 }} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="fire" size={15} colorClassName="accent-highlight" />
                </View>
                <View>
                  <Text className="text-[10px] font-bold text-copy-muted">{calories.incomplete ? "今日已知热量" : "今日热量"}</Text>
                  <View className="flex-row items-baseline gap-1 mt-0.5">
                    <Text className="text-xl font-black text-brand">{totalCalories ?? "未知"}</Text>
                    <Text className="text-[10px] text-copy-muted">/ {targetCalories} kcal · {targetLabel}</Text>
                  </View>
                </View>
              </View>
              <View className="bg-brand/10 px-2.5 py-1 rounded-full">
                <Text className="text-[11px] font-black text-brand">{calPercent == null ? "热量待补全" : `${calPercent}%`}</Text>
              </View>
            </View>

            {calPercent != null && <View className="h-1.5 rounded-full bg-background-secondary mt-3 overflow-hidden">
              <Animated.View
                className="h-full rounded-full bg-brand-fill"
                style={{
                  width: calorieProgress.interpolate({
                    inputRange: [0, 100],
                    outputRange: ["0%", "100%"],
                  }),
                }}
              />
            </View>}

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => activeCaloriePanel === 1 ? router.push("/health-data") : router.push("/diet-record")}
              className="mt-3 rounded-2xl bg-canvas border border-line px-3 py-2.5"
            >
              <Animated.View
                style={{
                  opacity: caloriePanelOpacity,
                  transform: [{ translateY: caloriePanelOffset }],
                }}
              >
                {activeCaloriePanel === 0 ? (
                  <View className="flex-row items-center">
                    {[
                      { label: "蛋白质", value: formatNutritionSummary(protein, "g") },
                      { label: "碳水", value: formatNutritionSummary(carbs, "g") },
                      { label: "脂肪", value: formatNutritionSummary(fat, "g") },
                    ].map((metric, index) => (
                      <View key={metric.label} className={`flex-1 items-center ${index < 2 ? "border-r border-line" : ""}`}>
                        <Text className="text-[9px] text-copy-muted">{metric.label}</Text>
                        <Text className="mt-0.5 text-xs font-black text-ink">{metric.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : activeCaloriePanel === 1 ? (
                  <View className="flex-row items-center">
                    {[
                      { label: "体重", value: healthProfile?.currentMeasurements?.weight == null ? "—" : `${healthProfile.currentMeasurements.weight.value} kg` },
                      { label: "体脂率", value: healthProfile?.currentMeasurements?.body_fat == null ? "—" : `${healthProfile.currentMeasurements.body_fat.value}%` },
                      { label: "饮水", value: `${todayWaterMl} ml` },
                    ].map((metric, index) => (
                      <View key={metric.label} className={`flex-1 items-center ${index < 2 ? "border-r border-line" : ""}`}>
                        <Text className="text-[9px] text-copy-muted">{metric.label}</Text>
                        <Text className="mt-0.5 text-xs font-black text-brand">{metric.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View className="h-[34px] flex-row items-center justify-between">
                    <View className="flex-1 mr-3">
                      <Text className="text-[9px] font-bold text-copy-muted">最近一餐 · 共 {todayRecords.length} 笔</Text>
                      <Text className="mt-0.5 text-xs font-black text-ink" numberOfLines={1}>
                        {todayRecords[0]?.food_name || "今天还没有记录饮食"}
                      </Text>
                    </View>
                    <Text className="text-xs font-black text-warm">
                      {todayRecords[0]?.calories == null ? "—" : `${todayRecords[0].calories} kcal`}
                    </Text>
                  </View>
                )}
              </Animated.View>
            </TouchableOpacity>

            <View className="mt-2.5 flex-row items-center justify-center gap-1.5">
              {[0, 1, 2].map((index) => (
                <View
                  key={index}
                  className={`h-1 rounded-full ${activeCaloriePanel === index ? "w-3.5 bg-brand-fill" : "w-1 bg-highlight/40"}`}
                />
              ))}
            </View>

            <View className="flex-row gap-2.5 mt-3 pt-3 border-t border-line">
              <TouchableOpacity
                onPress={() => router.push("/diet-record")}
                className="flex-1 bg-brand-fill py-2 rounded-xl items-center flex-row justify-center gap-1.5 active:opacity-80"
              >
                <FontAwesome6 name="plus" size={11} colorClassName="accent-on-brand" />
                <Text className="text-[11px] font-bold text-white">记一餐</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/health-data")}
                className="flex-1 bg-brand/10 py-2 rounded-xl items-center flex-row justify-center gap-1.5 active:opacity-80"
              >
                <FontAwesome6 name="heart-pulse" size={11} colorClassName="accent-brand" />
                <Text className="text-[11px] font-black text-brand">健康档案</Text>
              </TouchableOpacity>
            </View>
              </>
            )}
          </View>
        </View>

        {/* 板块一：食材与采购 (统合大卡片) */}
        <View className="px-5 mb-5">
          <View className="bg-surface rounded-[24px] p-5 pb-6 border border-line shadow-xs">
            {/* 顶栏标头与多导航入口 */}
            <View className="flex-row items-center justify-between pb-3.5 border-b border-line mb-3.5">
              <View className="flex-row items-center gap-2">
                <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="basket-shopping" size={13} colorClassName="accent-brand" />
                </View>
                <Text className="text-sm font-bold text-ink">
                  食材与采购 {inventoryItems.length > 0 ? `(${inventoryItems.length})` : ""}
                </Text>
              </View>

              <View className="flex-row items-center gap-3">
                <TouchableOpacity onPress={() => router.push("/shopping-list")}>
                  <Text className="text-xs font-bold text-warm">
                    采购单 {shoppingItems.filter(i => !i.checked).length > 0 ? `(${shoppingItems.filter(i => !i.checked).length})` : ""}
                  </Text>
                </TouchableOpacity>
                <Text className="text-xs text-copy-muted">·</Text>
                <TouchableOpacity onPress={() => router.push("/inventory")}>
                  <Text className="text-xs font-bold text-brand">保鲜库 →</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 内嵌智能采购横条 */}
            <TouchableOpacity
              onPress={() => router.push("/shopping-list")}
              activeOpacity={0.85}
              className="mb-3.5 bg-warm/10 p-3 rounded-2xl border border-warm/30 flex-row items-center justify-between"
            >
              <View className="flex-row items-center gap-2 flex-1 mr-2">
                <FontAwesome6 name="cart-shopping" size={12} colorClassName="accent-warm" />
                {shoppingItems.filter(i => !i.checked).length > 0 ? (
                  <View className="flex-row items-center gap-1.5 flex-1 flex-wrap">
                    <Text className="text-[11px] font-black text-warm">待买清单:</Text>
                    {shoppingItems.filter(i => !i.checked).slice(0, 3).map((item) => (
                      <View key={item.id} className="bg-surface/80 px-2 py-0.5 rounded-full border border-warm/30 flex-row items-center gap-1">
                        <Text className="text-[10px] font-bold text-ink">{item.name}</Text>
                        {item.amount ? <Text className="text-[9px] text-copy-muted">{item.amount}</Text> : null}
                      </View>
                    ))}
                    {shoppingItems.filter(i => !i.checked).length > 3 && (
                      <Text className="text-[9px] font-bold text-warm">
                        +{shoppingItems.filter(i => !i.checked).length - 3}
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text className="text-xs text-warm font-medium">采购清单空空如也，点此管理待买食材</Text>
                )}
              </View>
              <View className="flex-row items-center gap-1 bg-warm/20 px-2 py-1 rounded-full">
                <Text className="text-[10px] font-black text-warm">去买菜</Text>
                <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-warm" />
              </View>
            </TouchableOpacity>

            <Animated.View
              style={{ opacity: inventoryHighlightOpacity, transform: [{ translateY: inventoryHighlightOffset }] }}
            >
              <TouchableOpacity
                onPress={() => activeInventoryCard.prompt
                  ? router.push({ pathname: "/ai-assistant", params: { prefill_food: activeInventoryCard.title, prompt: activeInventoryCard.prompt } })
                  : router.push("/inventory")}
                className={`min-h-[96px] rounded-2xl border px-3.5 py-4 flex-row items-center gap-3 active:opacity-80 ${
                  activeInventoryCard.tone === "amber"
                    ? "border-warm/30 bg-warm-soft"
                    : "border-brand/15 bg-brand/5"
                }`}
              >
                <View className={`w-11 h-11 rounded-xl items-center justify-center ${activeInventoryCard.tone === "amber" ? "bg-warm/20" : "bg-surface"}`}>
                  <FontAwesome6 name={activeInventoryCard.icon} size={17} colorClassName={activeInventoryCard.tone === "amber" ? "accent-warm" : "accent-brand"} />
                </View>
                <View className="flex-1">
                  <Text className={`text-[10px] font-black ${activeInventoryCard.tone === "amber" ? "text-warm" : "text-brand"}`}>{activeInventoryCard.eyebrow}</Text>
                  <Text className="mt-0.5 text-sm font-black text-ink" numberOfLines={2}>{activeInventoryCard.title}</Text>
                  <Text className="mt-0.5 text-[11px] text-copy-muted" numberOfLines={1}>{activeInventoryCard.description}</Text>
                </View>
                <View className={`w-8 h-8 rounded-xl items-center justify-center ${activeInventoryCard.tone === "amber" ? "bg-warm-fill" : "bg-brand-fill"}`}>
                  <FontAwesome6 name={activeInventoryCard.prompt ? "wand-magic-sparkles" : "chevron-right"} size={10} colorClassName={activeInventoryCard.tone === "amber" ? "accent-warm" : "accent-on-brand"} />
                </View>
              </TouchableOpacity>
            </Animated.View>

            <View className="mt-4">
              <Text className="mb-2 text-[10px] font-bold text-copy-muted">按存放方式查看</Text>
              <View className="flex-row gap-2">
                {[
                  { label: "冷藏", count: storageGroups.冷藏.length },
                  { label: "冷冻", count: storageGroups.冷冻.length },
                  { label: "常温", count: storageGroups.常温.length },
                  { label: "位置待确认", count: storageGroups.位置待确认.length },
                ].map((storage) => (
                  <TouchableOpacity
                    key={storage.label}
                    onPress={() => router.push("/inventory")}
                    className="flex-1 rounded-xl border border-line bg-background-secondary px-2 py-3 items-center active:opacity-80"
                  >
                    <Text className="text-lg font-black text-brand">{storage.count}</Text>
                    <Text className="mt-0.5 text-[10px] font-bold text-copy-muted">{storage.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              onPress={() => router.push("/inventory", { action: "add" })}
              className="mt-3.5 rounded-2xl bg-brand-fill px-4 py-3 flex-row items-center justify-center gap-2.5 active:opacity-80"
            >
              <View className="w-7 h-7 rounded-full bg-surface/15 items-center justify-center">
                <FontAwesome6 name="plus" size={11} colorClassName="accent-on-brand" />
              </View>
              <View>
                <Text className="text-xs font-black text-white">录入食材</Text>
                <Text className="mt-0.5 text-[9px] text-emerald-100/80">拍照识别或手动添加</Text>
              </View>
            </TouchableOpacity>

            {inventoryHighlights.length > 1 && (
              <View className="mt-4 flex-row justify-center gap-1.5">
                {inventoryHighlights.map((highlight, index) => (
                  <View key={highlight.eyebrow} className={`h-1.5 rounded-full ${activeInventoryHighlight === index ? "w-4 bg-brand-fill" : "w-1.5 bg-highlight/40"}`} />
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 板块二：食光社区精选 (大卡片统合容器) */}
        <View className="px-5 mb-5">
          <View className="bg-surface rounded-[24px] p-5 border border-line shadow-xs">
            <View className="flex-row items-center justify-between pb-3.5 border-b border-line mb-3.5">
              <View className="flex-row items-center gap-2">
                <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="compass" size={13} colorClassName="accent-brand" />
                </View>
                <Text className="text-sm font-bold text-ink">食光社区精选</Text>
              </View>
              <TouchableOpacity onPress={() => router.push("/community")}>
                <Text className="text-xs font-bold text-brand">互动社区 →</Text>
              </TouchableOpacity>
            </View>

            {featuredCommunityPost ? (
              <Animated.View style={{ opacity: communityPostOpacity, transform: [{ translateY: communityPostOffset }] }}>
                <TouchableOpacity
                  onPress={() => router.push("/community")}
                  className="flex-row gap-3 rounded-2xl bg-canvas p-3 active:opacity-80"
                >
                  <View className="flex-1 min-h-[84px]">
                    <View className="flex-row items-center gap-2 mb-2">
                      <Image
                        source={getAvatarSource(featuredCommunityPost.avatar_url, featuredCommunityPost.user_id ?? featuredCommunityPost.username)}
                        className="w-6 h-6 rounded-full"
                        style={{ width: 24, height: 24, borderRadius: 12 }}
                      />
                      <Text className="text-xs font-bold text-ink" numberOfLines={1}>{featuredCommunityPost.username}</Text>
                      <View className="bg-brand/10 px-1.5 py-0.5 rounded-md">
                        <Text className="text-[9px] font-bold text-brand">精选</Text>
                      </View>
                    </View>
                    <Text className="text-xs text-copy-muted leading-4" numberOfLines={3}>{featuredCommunityPost.content}</Text>
                    <View className="mt-2 flex-row items-center gap-1">
                      <FontAwesome6 name="heart" size={10} colorClassName="accent-critical" />
                      <Text className="text-[10px] font-semibold text-copy-muted">{featuredCommunityPost.likes_count} 赞</Text>
                    </View>
                  </View>
                  {featuredCommunityPost.image_url ? (
                    <Image source={{ uri: resolveMediaUrl(featuredCommunityPost.image_url) }} className="w-20 rounded-xl" resizeMode="cover" />
                  ) : (
                    <View className="w-20 rounded-xl bg-brand/10 items-center justify-center">
                      <FontAwesome6 name="leaf" size={18} colorClassName="accent-brand" />
                    </View>
                  )}
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <TouchableOpacity onPress={() => router.push("/community")} className="rounded-2xl bg-canvas p-4 items-center">
                <Text className="text-xs font-bold text-copy-muted">社区正在准备新的健康灵感</Text>
              </TouchableOpacity>
            )}
            {communityPosts.length > 1 && (
              <View className="mt-3 flex-row justify-center gap-1.5">
                {communityPosts.map((post, index) => (
                  <View key={post.id} className={`h-1.5 rounded-full ${activeCommunityPost === index ? "w-4 bg-brand-fill" : "w-1.5 bg-highlight/40"}`} />
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 板块三：灵感食谱 (大卡片统合容器) */}
        <View className="px-5 mb-8">
          <View className="bg-surface rounded-[24px] p-5 border border-line shadow-xs">
            <View className="pb-3.5 border-b border-line mb-3.5">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-2">
                  <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                    <FontAwesome6 name="utensils" size={13} colorClassName="accent-brand" />
                  </View>
                  <Text className="text-sm font-bold text-ink">灵感食谱</Text>
                </View>
              </View>

              <View className="flex-row gap-2.5">
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setActiveCategory(cat)}
                    className={`px-3.5 py-1.5 rounded-full border ${
                      activeCategory === cat
                        ? "bg-brand-fill border-brand"
                        : "bg-surface border-line"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        activeCategory === cat ? "text-white" : "text-copy-muted"
                      }`}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {loading ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="small" colorClassName="accent-brand" />
              </View>
            ) : filteredRecipes.length === 0 ? (
              <View className="py-8 items-center">
                <FontAwesome6 name="utensils" size={24} colorClassName="accent-warm" />
                <Text className="text-xs font-bold text-copy-muted mt-2">暂无符合条件的食谱</Text>
              </View>
            ) : (
              <View className="gap-3">
                {visibleRecipes.map((recipe) => (
                  <TouchableOpacity
                    key={recipe.id}
                    onPressIn={() => void recipesApi.prefetchDetail(recipe.id).catch(() => undefined)}
                    onPress={() =>
                      router.push(`/recipe-detail?id=${recipe.id}`)
                    }
                    className="bg-surface rounded-2xl overflow-hidden border border-line shadow-2xs active:opacity-90"
                  >
                    <View className="relative h-36 w-full">
                      <RecipeCover
                        uri={recipe.image_url}
                        className="w-full h-full"
                        placeholderClassName="h-full w-full items-center justify-center bg-brand-soft"
                      />
                      <View className="absolute top-2.5 left-2.5 bg-ink/70 backdrop-blur-md px-2.5 py-0.5 rounded-full">
                        <Text className="text-[10px] font-bold text-white">{recipe.category}</Text>
                      </View>
                      {recipe.inventoryMatchNames.length > 0 && (
                        <View className={`absolute bottom-2.5 left-2.5 px-2.5 py-0.5 rounded-full flex-row items-center gap-1 shadow-2xs ${recipe.expiringMatchCount > 0 ? "bg-warm-fill" : "bg-brand/90"}`}>
                          <FontAwesome6
                            name={recipe.expiringMatchCount > 0 ? "clock-rotate-left" : "basket-shopping"}
                            size={9}
                            colorClassName="accent-on-brand"
                          />
                          <Text className="text-[10px] font-bold text-white">
                            {recipe.expiringMatchCount > 0
                              ? `优先消耗 · 匹配${recipe.inventoryMatchNames.length}种`
                              : `库存匹配 ${recipe.inventoryMatchNames.length}种`}
                          </Text>
                        </View>
                      )}
                      <View className="absolute bottom-2.5 right-2.5 bg-surface/90 px-2 py-0.5 rounded-full flex-row items-center gap-1">
                        <FontAwesome6 name="clock" size={10} colorClassName="accent-brand" />
                        <Text className="text-[10px] font-bold text-brand">{recipe.cook_time == null ? '用时未标注' : `${recipe.cook_time}分钟`}</Text>
                      </View>
                    </View>

                    <View className="p-3">
                      <Text className="text-sm font-bold text-ink" numberOfLines={1}>
                        {recipe.title}
                      </Text>
                      <Text className="text-xs text-copy-muted mt-1" numberOfLines={2}>
                        {recipe.description}
                      </Text>

                      <View className="flex-row items-center justify-between mt-2.5 pt-2.5 border-t border-background-secondary">
                        <View className="flex-row items-center gap-3">
                          <Text className="text-xs font-bold text-brand">
                            <FontAwesome6 name="fire" size={11} colorClassName="accent-brand" /> {recipe.nutrition_basis === 'unknown' || recipe.calories == null ? '营养待补全' : `${recipe.nutrition_is_estimated ? '约' : ''}${recipe.calories} kcal`}
                          </Text>
                          <Text className="text-xs text-copy-muted">
                            {recipe.nutrition_basis === 'unknown' || recipe.protein == null ? '蛋白质未知' : `蛋白 ${recipe.protein}g`}
                          </Text>
                        </View>
                        {recipe.nutrition_is_estimated ? <Text className="text-[10px] font-bold text-warm">营养估算</Text> : null}
                        <View className="bg-brand/10 px-2.5 py-1 rounded-full">
                          <Text className="text-xs font-bold text-brand">开启烹饪 →</Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
                {hasMoreRecipes ? (
                  <View className="items-center py-2">
                    <Text className="text-[11px] font-bold text-copy-muted">
                      继续下滑，加载更多灵感
                    </Text>
                  </View>
                ) : filteredRecipes.length > RECIPE_BATCH_SIZE ? (
                  <View className="items-center py-2">
                    <Text className="text-[11px] text-copy-muted">已为你展示全部食谱</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <TodayRecordsModal
        visible={allRecordsModalVisible}
        records={todayRecords}
        onClose={() => setAllRecordsModalVisible(false)}
        onAddRecord={() => {
          setAllRecordsModalVisible(false);
          router.push("/diet-record");
        }}
      />
    </Screen>
  );
}
