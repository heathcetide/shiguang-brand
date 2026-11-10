import { SavedInventoryEvidence } from "./SavedInventoryEvidence";
import { useKitchenwareAttributesForm } from "./useKitchenwareAttributesForm";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Animated,
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Alert,
  DeviceEventEmitter,
  Platform,
  PanResponder,
  useWindowDimensions,
} from "react-native";
import { useAppThemeColors } from "@/hooks/useAppThemeColors";
import { Screen } from "@/components/Screen";
import { RecipeCover } from "@/components/RecipeCover";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { SmartDateInput } from "@/components/SmartDateInput";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  getUserStorageKey,
  getPrivateStorageGeneration,
} from "@/utils/userStorage";
import { dateKeyAfterDays } from "@/utils/date";
import { daysUntilDateKey, getExpirationBadgeConfig, getInventoryStatus, formatInventoryQuantity } from "@/utils/inventory";
import { aiApi, authApi, cookingQueueApi, foodsApi, healthApi, householdApi, insightsApi, recommendationsApi, recipesApi, shoppingListApi, type Household, type HouseholdActivityLog, type HouseholdInventoryItem, type RecipeRecommendationItem, type RecipeRecommendationPage } from "@/services/api";
import type { DetectedFood, InventoryItem, KitchenwareCatalogItem, KitchenwareItem, Recipe, StorageLocation } from "./types";
import { buildInventoryStorageGroups } from "./storageGroups";
import { inferFoodCategory, MAX_AI_IMAGE_BASE64_LENGTH, mergeDetectedFoods, normalizeDetectedFoods } from "./scan";
import { useInventoryData } from "./useInventoryData";
import { useInventoryMutations } from "./useInventoryMutations";
import { InventorySegmentTabs, type InventorySegment } from "./InventorySegmentTabs";
import { KitchenwareSection, type KitchenwareStarterKit } from "./KitchenwareSection";
import { InventoryEntryForm } from "./InventoryEntryForm";
import { ManualInventoryEntry } from "./ManualInventoryEntry";
import { InventoryTextIntake } from "./InventoryTextIntake";
import { useRecognitionReview } from "./useRecognitionReview";
import { buildRecognitionIntake, quantityFields } from "./intakeEntry";
import { normalizeShoppingItems } from "@/utils/shoppingList";
import { analyzeRecipeInventoryMatch, filterAndRankRecipes, filterInventoryItems, filterKitchenware } from "./selectors";
import {
  BatchReviewModal,
  CatalogDetailModal,
  ExpiredCleanupModal,
  InventoryHistoryModal,
  type ExpiredCleanupResult,
} from "./InventoryModals";
import { FamilyShareModal } from "./FamilyShareModal";
import {
  addInventoryLog,
  clearInventoryHistory,
  getInventoryHistory,
  type InventoryLogEntry,
} from "@/utils/inventoryHistory";
import { scheduleExpiringStockAlerts, type NotificationPreferences } from "@/utils/notifications";
import {
  COMMON_INGREDIENTS,
  inferCategoryByName,
  inferIngredientDefaults,
  inferShelfLifeDays,
  searchCommonIngredients,
  type CommonIngredient,
} from "@/utils/ingredientRules";
import type { HealthProfile } from "@/utils/healthProfile";
import { appendUniqueItemsByKey } from "@/utils/pagination";

const KITCHENWARE_STARTER_KITS = [
  { name: "轻食减脂", items: ["空气炸锅", "平底锅", "电子秤", "玻璃保鲜盒"] },
  { name: "中式家常", items: ["炒锅", "汤锅", "蒸锅", "菜刀", "砧板"] },
  { name: "烘焙入门", items: ["烤箱", "烤盘", "蛋糕模具", "打蛋器", "硅胶刮刀"] },
] as const;

export default function InventoryScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const colors = useAppThemeColors();
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const noticeCardWidth = Math.max(windowWidth - 40, 280);
  const [inventoryGridWidth, setInventoryGridWidth] = useState(0);
  const inventoryCardWidth = inventoryGridWidth > 0
    ? Math.floor((inventoryGridWidth - 10) / 2)
    : undefined;
  const router = useSafeRouter();
  const { action, highlightItemId } = useSafeSearchParams<{ action?: string; highlightItemId?: number }>();
  const { isAuthenticated, token, user } = useAuth();
  const inventoryScanJobStorageKey = getUserStorageKey(
    INVENTORY_SCAN_JOB_STORAGE_KEY,
    user?.id,
  );
  const recognitionOwner = useRef(user?.id);
  recognitionOwner.current = user?.id;
  const authFetch = useAuthFetch();
  const {
    items,
    setItems,
    recipes,
    recipeTotal,
    recipeLibrarySummary,
    hasMoreRecipes: hasMoreRecipePages,
    kitchenware,
    kitchenwareCatalog,
    loadingItems,
    loadingRecipes,
    loadingMoreRecipes,
    loadingKitchenware,
    sectionErrors,
    refresh: fetchData,
    reloadRecipes,
    loadMoreRecipes,
  } = useInventoryData(authFetch, isAuthenticated, user?.id);
  const inventoryMutations = useInventoryMutations(authFetch, user?.id);
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setHealthProfile(null);
      return;
    }
    void healthApi.profile<HealthProfile>(authFetch).then(setHealthProfile).catch(() => setHealthProfile(null));
  }, [authFetch, isAuthenticated]);

  // Top Level Segment State
  const [activeSegment, setActiveSegment] = useState<InventorySegment>("inventory");

  useEffect(() => {
    if (highlightItemId) setActiveSegment("inventory");
  }, [highlightItemId]);

  useEffect(() => {
    DeviceEventEmitter.emit("inventory-segment-change", activeSegment);
  }, [activeSegment]);

  // Kitchenware State
  const [activeKitchenwareCategory, setActiveKitchenwareCategory] = useState("全部");
  const [kitchenwareModalVisible, setKitchenwareModalVisible] = useState(false);
  const [editingKitchenware, setEditingKitchenware] = useState<KitchenwareItem | null>(null);
  const [kwName, setKwName] = useState("");
  const [kwCategory, setKwCategory] = useState("小家电");
  const [kwStatus, setKwStatus] = useState("良好");
  const [kwNote, setKwNote] = useState("");
  const [kwImageUrl, setKwImageUrl] = useState("");
  const [kwPurchaseDate, setKwPurchaseDate] = useState("");
  const kitchenwareAttributesForm = useKitchenwareAttributesForm();
  const [savingKitchenware, setSavingKitchenware] = useState(false);
  const [selectedCatalogKitchenware, setSelectedCatalogKitchenware] = useState<KitchenwareCatalogItem | null>(null);
  const [addingStarterKit, setAddingStarterKit] = useState<string | null>(null);

  const openKitchenwareModal = (item?: KitchenwareItem) => {
    setEditingKitchenware(item || null);
    setKwName(item?.name || "");
    setKwCategory(item?.category || "小家电");
    setKwStatus(item?.status || "良好");
    setKwNote(item?.note || "");
    setKwImageUrl(item?.image_url || "");
    setKwPurchaseDate(item?.purchase_date || "");
    kitchenwareAttributesForm.reset(item?.attributes);
    setKitchenwareModalVisible(true);
  };

  const handleSaveKitchenware = async () => {
    if (!kwName.trim()) {
      Alert.alert("提示", "请输入厨具名称");
      return;
    }
    const attributes = kitchenwareAttributesForm.parse();
    if (!attributes.success) { Alert.alert("规格无效","请输入有效的正数容量或直径；未核对可留空。"); return; }
    try {
      setSavingKitchenware(true);
      const payload = {
          name: kwName,
          attributes: attributes.data,
          category: kwCategory,
          status: kwStatus,
          note: kwNote,
          image_url: kwImageUrl.trim() || null,
          purchase_date: kwPurchaseDate || null,
      };
      if (editingKitchenware) await inventoryMutations.updateKitchenware.mutateAsync({ id: editingKitchenware.id, input: payload });
      else await inventoryMutations.createKitchenware.mutateAsync(payload);
      setKitchenwareModalVisible(false);
      Alert.alert("保存成功", `厨具【${kwName}】已保存到我的装备库。`);
    } catch {
      Alert.alert("保存失败", "网络异常，请稍后重试");
    } finally {
      setSavingKitchenware(false);
    }
  };

  const addCatalogKitchenware = async (item: KitchenwareCatalogItem) => {
    if (kitchenware.some((owned) => owned.name === item.name)) {
      Alert.alert("已在装备库", `你已录入【${item.name}】。`);
      return;
    }
    try {
      setSavingKitchenware(true);
      await inventoryMutations.createKitchenware.mutateAsync({
        name: item.name, category: item.category, status: "良好", note: item.care_note || "", image_url: null, purchase_date: null,
      });
      setSelectedCatalogKitchenware(null);
      Alert.alert("已加入装备库", `已添加【${item.name}】，现在可用于食谱匹配和保养提醒。`);
    } catch {
      Alert.alert("添加失败", "网络异常，请稍后重试");
    } finally {
      setSavingKitchenware(false);
    }
  };

  const addStarterKit = async (kit: KitchenwareStarterKit) => {
    const targets = kitchenwareCatalog.filter((item) => kit.items.some((name) => name === item.name) && !kitchenware.some((owned) => owned.name === item.name));
    if (!targets.length) {
      Alert.alert("已配置完成", `「${kit.name}」套装中的厨具已都在你的装备库。`);
      return;
    }
    try {
      setAddingStarterKit(kit.name);
      await Promise.all(targets.map((item) => inventoryMutations.createKitchenware.mutateAsync({
        name: item.name, category: item.category, status: "良好", note: item.care_note || "", image_url: null, purchase_date: null,
      })));
      Alert.alert("套装已加入", `已将 ${targets.length} 件「${kit.name}」装备加入你的资产库。`);
    } catch {
      Alert.alert("添加失败", "部分厨具可能未保存，请刷新后重试。");
    } finally {
      setAddingStarterKit(null);
    }
  };

  // Inventory State
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const dragPan = useRef(new Animated.ValueXY()).current;
  const longPressedItemId = useRef<number | null>(null);
  const storageFolderRefs = useRef<Partial<Record<StorageLocation, View | null>>>({});
  const [activeInventoryCategory, setActiveInventoryCategory] = useState("全部");
  const [activeNoticeSlide, setActiveNoticeSlide] = useState(0);
  const noticeScrollViewRef = useRef<ScrollView>(null);
  const activeNoticeSlideRef = useRef(activeNoticeSlide);
  const noticeLastInteractionAtRef = useRef(0);
  activeNoticeSlideRef.current = activeNoticeSlide;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [entryMode, setEntryMode] = useState<"choose" | "manual">("choose");

  // Form State for Inventory Item
  const [foodName, setFoodName] = useState("");
  const [category, setCategory] = useState("蔬菜");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [expirationDate, setExpirationDate] = useState(
    dateKeyAfterDays(7)
  );
  const [storageLocation, setStorageLocation] = useState("冷藏");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [aiAssisting, setAiAssisting] = useState(false);
  const [batchReviewVisible, setBatchReviewVisible] = useState(false);
  const review = useRecognitionReview(value => {
    setSavingDetectedFoods(false);
    setBatchReviewVisible(Boolean(value.foods.length || value.pending));
    setPendingScanJobId(value.jobId);
  });
  const detectedFoods = review.value.foods;
  const setDetectedFoods = review.setFoods;
  const [savingDetectedFoods, setSavingDetectedFoods] = useState(false);
  const [pendingScanJobId, setPendingScanJobId] = useState<string | null>(null);
  const intakeBatchKey = review.value.batchKey;
  const pendingIntakeSource = review.value.source;
  const setPendingIntakeSource = (source: "barcode" | "receipt" | "image") => { void review.update({ source }).catch(() => undefined); };
  const [barcodeScannerVisible, setBarcodeScannerVisible] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeLookingUp, setBarcodeLookingUp] = useState(false);
  const scannedBarcodesRef = useRef(new Set<string>());
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [suggestions, setSuggestions] = useState<Array<{ name: string; category?: string }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Recipe Filter State (Phase 2: 今天吃什么)
  const [cookTimeLimit, setCookTimeLimit] = useState<number>(0);
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>("全部");

  // Inventory Maintenance State (Phase 3: 扣减、过期清理、操作历史、提醒)
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<InventoryLogEntry[]>([]);
  const [clearingExpired, setClearingExpired] = useState(false);
  const [expiredCleanupVisible, setExpiredCleanupVisible] = useState(false);
  const [expiredCleanupResult, setExpiredCleanupResult] = useState<ExpiredCleanupResult | null>(null);
  const [expiringAlertsEnabled, setExpiringAlertsEnabled] = useState(false);

  // Household Family Sharing State (Phase 5)
  const [familyModalVisible, setFamilyModalVisible] = useState(false);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<Household | null>(null);

  const refreshHouseholds = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const list = await householdApi.mine(authFetch);
      setHouseholds(list);
    } catch {
      // ignore
    }
  }, [authFetch, isAuthenticated]);

  useEffect(() => {
    void refreshHouseholds();
  }, [refreshHouseholds]);

  const loadFamilyInventory = useCallback(async () => {
    if (!activeHousehold || !isAuthenticated) return;
    try {
      const familyItems = await householdApi.inventoryList(authFetch, activeHousehold.id);
      const mapped: InventoryItem[] = familyItems.map((fi: HouseholdInventoryItem) => ({
        id: fi.id,
        user_id: fi.created_by_user_id,
        food_name: fi.food_name,
        category: fi.category,
        quantity: fi.quantity,
        expiration_date: fi.expiration_date,
        storage_location: fi.storage_location as StorageLocation,
        image_url: fi.image_url || null,
        is_available: fi.is_available,
        scope: "shared",
        created_at: fi.created_at,
        creator_name: fi.creator_name,
        version: fi.version,
      }));
      setItems(mapped);
    } catch {
      // ignore
    }
  }, [activeHousehold, authFetch, isAuthenticated, setItems]);

  useEffect(() => {
    if (activeHousehold) {
      void loadFamilyInventory();
    } else {
      void fetchData();
    }
  }, [activeHousehold, loadFamilyInventory, fetchData]);

  useEffect(() => {
    let active = true;
    setExpiringAlertsEnabled(false);
    if (!token || !user?.id) return () => { active = false; };
    void authApi.notificationPreferences<NotificationPreferences>(token)
      .then((preferences) => {
        if (active) setExpiringAlertsEnabled(preferences.expiring_alert);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [token, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void scheduleExpiringStockAlerts(items, user.id, expiringAlertsEnabled);
  }, [expiringAlertsEnabled, items, user?.id]);

  // 保鲜库顶部通知卡片自动轮播 (Auto Play Notice Carousel)
  useEffect(() => {
    if (activeSegment !== "inventory") return;

    const expiredCount = items.filter((i) => getInventoryStatus(i).freshness === "expired").length;
    const urgentExpiringItems = items.filter((i) => getInventoryStatus(i).freshness === "expiring");
    const count =
      (expiredCount > 0 ? 1 : 0) +
      (urgentExpiringItems.length > 0 ? 1 : (expiredCount > 0 ? 0 : 1)) +
      1 +
      (items.length > 0 ? 1 : 0);

    if (count <= 1) return;

    const intervalId = setInterval(() => {
      if (Date.now() - noticeLastInteractionAtRef.current < 6000) return;
      const nextSlide = (activeNoticeSlideRef.current + 1) % count;
      const xOffset = nextSlide * (noticeCardWidth + 10);
      noticeScrollViewRef.current?.scrollTo({ x: xOffset, animated: true });
      setActiveNoticeSlide(nextSlide);
    }, 4000);

    return () => clearInterval(intervalId);
  }, [activeSegment, items, noticeCardWidth]);

  const openHistoryModal = async () => {
    if (activeHousehold) {
      try {
        const familyLogs = await householdApi.historyList(authFetch, activeHousehold.id);
        const mappedLogs: InventoryLogEntry[] = familyLogs.map((l: HouseholdActivityLog) => ({
          id: String(l.id),
          foodName: `${l.food_name} (@${l.operator_name || "成员"})`,
          action: l.action,
          quantity: l.quantity,
          storageLocation: l.storage_location,
          timestamp: Date.parse(l.created_at) || Date.now(),
        }));
        setHistoryLogs(mappedLogs);
      } catch {
        setHistoryLogs([]);
      }
    } else {
      const logs = await getInventoryHistory(user?.id);
      setHistoryLogs(logs);
    }
    setHistoryModalVisible(true);
  };

  const handleClearHistory = async () => {
    if (!activeHousehold) {
      await clearInventoryHistory(user?.id);
    }
    setHistoryLogs([]);
  };

  const handleQuickConsumeItem = async (item: InventoryItem) => {
    const saveOutcome = async (outcome: "used" | "discarded" | "expired" | "gifted" | "transferred" | "unknown") => {
      try {
        await insightsApi.recordOutcome(authFetch, activeHousehold ? {
          scope: "household", householdId: activeHousehold.id, itemId: item.id,
          itemVersion: item.version || 1, outcome, source: "manual",
          idempotencyKey: `household-outcome-${outcome}:${activeHousehold.id}:${item.id}:v${item.version || 1}`,
          closeItem: true,
        } : {
          scope: "personal", itemId: item.id, itemVersion: item.version || 1,
          outcome, source: "manual",
          idempotencyKey: `personal-outcome-${outcome}:${item.id}:v${item.version || 1}`,
          closeItem: true,
        });
        if (activeHousehold) await loadFamilyInventory();
        else {
          await addInventoryLog({ foodName: item.food_name, action: "consume", quantity: item.quantity, storageLocation: item.storage_location }, user?.id);
          await fetchData();
        }
      } catch (error) {
        Alert.alert("结果记录失败", error instanceof Error ? error.message : "请刷新库存后重试");
      }
    };
    Alert.alert("记录库存结果", `【${item.food_name}】最后如何处理？未知结果不会算作节约或浪费。`, [
      { text: "取消", style: "cancel" },
      {
        text: "已吃完/用完",
        onPress: () => void saveOutcome("used"),
      },
      {
        text: "其他结果",
        onPress: () => Alert.alert("选择实际结果", "分类后仍可在周报中修正。", [
          { text: "丢弃", onPress: () => void saveOutcome("discarded") },
          { text: "赠送", onPress: () => void saveOutcome("gifted") },
          { text: "转移", onPress: () => void saveOutcome("transferred") },
          { text: "结果未知", onPress: () => void saveOutcome("unknown") },
          { text: "取消", style: "cancel" },
        ]),
      },
    ]);
  };

  const getExpiredItems = () => items.filter(
    (item) => getInventoryStatus(item).freshness === "expired"
  );

  const handleBatchClearExpired = () => {
    if (getExpiredItems().length === 0) return;
    setExpiredCleanupResult(null);
    setExpiredCleanupVisible(true);
  };

  const confirmBatchClearExpired = async () => {
    const expiredItems = getExpiredItems();
    if (expiredItems.length === 0 || clearingExpired) return;

    setClearingExpired(true);
    const removalResults = await Promise.allSettled(
      expiredItems.map((item) => insightsApi.recordOutcome(authFetch, activeHousehold ? {
        scope: "household", householdId: activeHousehold.id, itemId: item.id,
        itemVersion: item.version || 1, outcome: "expired", source: "cleanup",
        idempotencyKey: `household-outcome-expired:${activeHousehold.id}:${item.id}:v${item.version || 1}`,
        closeItem: true,
      } : {
        scope: "personal", itemId: item.id, itemVersion: item.version || 1,
        outcome: "expired", source: "cleanup",
        idempotencyKey: `personal-outcome-expired:${item.id}:v${item.version || 1}`,
        closeItem: true,
      }))
    );
    const succeededItems = expiredItems.filter((_, index) => removalResults[index]?.status === "fulfilled");
    const failedCount = expiredItems.length - succeededItems.length;

    if (!activeHousehold && succeededItems.length > 0) {
      await Promise.allSettled(
        succeededItems.map((item) => addInventoryLog(
          {
            foodName: item.food_name,
            action: "expire_clear",
            quantity: item.quantity,
            storageLocation: item.storage_location,
          },
          user?.id
        ))
      );
    }

    if (succeededItems.length > 0) {
      const succeededIds = new Set(succeededItems.map((item) => item.id));
      setItems((current) => current.filter((item) => !succeededIds.has(item.id)));
      if (activeHousehold) await loadFamilyInventory();
      else await fetchData();
    }

    setExpiredCleanupResult({ succeeded: succeededItems.length, failed: failedCount });
    setClearingExpired(false);
  };

  const handleAddMissingFromCard = async (recipeTitle: string, missingItems: Array<{ name: string; amount?: string }>) => {
    if (!missingItems.length) return;
    try {
      const normalized = normalizeShoppingItems(await shoppingListApi.list<unknown[]>(authFetch));
      const existingNames = new Set(normalized.map((i) => i.name));

      const newItems = missingItems
        .filter((item) => !existingNames.has(item.name))
        .map((item) => ({
          clientId: `recipe-missing:${recipeTitle}:${item.name}`,
          name: item.name,
          amount: item.amount || "适量",
          category: inferCategoryByName(item.name),
          checked: false,
        }));

      if (newItems.length === 0) {
        Alert.alert("已在采购清单", "缺失食材已在你的采购清单中。");
        return;
      }

      await Promise.all(newItems.map((item) => shoppingListApi.create(authFetch, item)));
      Alert.alert("已加入采购清单", `已为【${recipeTitle}】将 ${newItems.length} 种缺少食材加入采购清单！`, [
        { text: "查看清单", onPress: () => router.push("/shopping-list") },
        { text: "好的", style: "cancel" },
      ]);
    } catch {
      Alert.alert("添加失败", "保存采购清单失败，请重试。");
    }
  };

  const handleRecipeExecution = async (
    recipe: Recipe,
    analysis: ReturnType<typeof analyzeRecipeInventoryMatch>,
    startImmediately = false,
  ) => {
    if (!isAuthenticated) {
      router.push("/login", { returnTo: { pathname: "/inventory" } });
      return;
    }
    if (analysis.blocked) {
      const reason = analysis.healthConflicts.some((risk) => risk.severity === "severe")
        ? `检测到严重过敏冲突：${analysis.healthConflicts.map((risk) => risk.name).join("、")}`
        : `缺少必需厨具：${analysis.missingKitchenware.join("、")}`;
      Alert.alert("暂不能执行", `${reason}。请先处理安全限制或选择可靠替代方案。`);
      return;
    }
    try {
      const queued = await cookingQueueApi.add(authFetch, { recipeId: recipe.id });
      if (!startImmediately) {
        Alert.alert("已加入烹饪队列", `库存覆盖 ${analysis.coveragePercent}%，可在队列继续备料和补齐缺项。`, [
          { text: "查看队列", onPress: () => router.push("/cooking-queue", { highlightRecipeId: recipe.id }) },
          { text: "继续浏览", style: "cancel" },
        ]);
        return;
      }
      const started = await cookingQueueApi.start(authFetch, queued.item.id, queued.item.version);
      router.push("/cooking-mode", {
        recipeId: recipe.id,
        fromQueue: true,
        queueItemId: started.id,
        queueVersion: started.version,
      });
    } catch (error) {
      Alert.alert("操作失败", error instanceof Error ? error.message : "请刷新后重试");
    }
  };

  const applyIngredientDefaults = (name: string, explicitLocation?: StorageLocation) => {
    const defaults = inferIngredientDefaults(name, explicitLocation || (storageLocation as StorageLocation));
    setFoodName(name);
    setCategory(defaults.category);
    setStorageLocation(defaults.storageLocation);
    setExpirationDate(defaults.expirationDate);
    setSuggestions([]);
  };

  const handleFoodNameChange = (text: string) => {
    setFoodName(text);
    if (!text.trim()) {
      setSuggestions([]);
      return;
    }
    const local = searchCommonIngredients(text).map((item) => ({ name: item.name, category: item.category }));
    setSuggestions(local);
  };

  useEffect(() => {
    if (foodName.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        setLoadingSuggestions(true);
        const remote = await foodsApi.search<{ name: string; category?: string }>(foodName.trim());
        if (active && Array.isArray(remote) && remote.length > 0) {
          setSuggestions((prev) => {
            const names = new Set(prev.map((p) => p.name));
            const newItems = remote.filter((r) => r.name && !names.has(r.name)).slice(0, 5);
            return [...prev, ...newItems];
          });
        }
      } catch {
        // ignore network failure
      } finally {
        if (active) setLoadingSuggestions(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [foodName]);

  const handleStorageLocationChange = (newLoc: StorageLocation) => {
    setStorageLocation(newLoc);
    if (foodName.trim()) {
      const days = inferShelfLifeDays(foodName.trim(), newLoc);
      setExpirationDate(dateKeyAfterDays(days));
    }
  };

  const handleAddPresetToBatch = (preset: CommonIngredient) => {
    const defaults = inferIngredientDefaults(preset.name);
    const newItem: DetectedFood = {
      id: `batch-${Date.now()}-${Math.random()}`,
      foodName: preset.name,
      quantity: "",
      suggestedStorageLocation: defaults.storageLocation,
      estimatedExpireDays: defaults.shelfLifeDays,
      selected: true,
    };
    setDetectedFoods((prev) => [newItem, ...prev]);
  };

  useEffect(() => {
    if (isAuthenticated) return;
    setModalVisible(false);
    setBatchReviewVisible(false);
    setKitchenwareModalVisible(false);
    setSelectedCatalogKitchenware(null);
  }, [isAuthenticated]);

  const suggestedDate = (days: number) => dateKeyAfterDays(days);

  const presentScanRecognition = async (recognized: DetectedFood[], jobId: string, isActive = () => true) => {
    const canPresent = () => isActive() && review.canPresent(jobId);
    if (!canPresent()) return;
    const accepted = await inventoryMutations.acceptScan.mutateAsync(jobId);
    if (!canPresent()) return;
    if (accepted.items.length) void fetchData();
    const savedIds = new Set(accepted.savedSourceItemIds);
    const reviewed = review.current.current.jobId === jobId ? review.current.current.foods : recognized;
    const remaining = reviewed.filter(item => !savedIds.has(item.id));
    if (accepted.items.length) Alert.alert("识别项目已保存", `${accepted.items.map(item => item.food_name).join("、")}已保存。${remaining.length ? `还有 ${remaining.length} 项需要确认。` : "本次项目已全部保存。"}`, [
      { text: "关闭", style: "cancel" },
      { text: "撤销本次入库", onPress: () => { void inventoryMutations.undoScan.mutateAsync(jobId).then(() => {
        if (!isActive()) return;
        void fetchData();
        Alert.alert("已撤销", "本次已入库食材已撤销。");
      }).catch(error => { if (isActive()) Alert.alert("未能撤销", error instanceof Error ? error.message : "请检查网络后重试"); }); } },
    ]);
    else if (accepted.undoneSourceItemIds.length) Alert.alert("本次入库已撤销", remaining.length ? `还有 ${remaining.length} 项尚未确认。` : "未重新添加已撤销的项目。");
    if (remaining.length) presentRecognition(remaining, true, jobId);
    else if (!recognized.length) presentRecognition([], true);
  };

  const getScanJob = async (jobId: string) => {
    return aiApi.inventoryScan<{ status: string; items?: unknown; error?: string }>(authFetch, jobId);
  };

  const waitForScanJob = async (jobId: string): Promise<DetectedFood[]> => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const job = await getScanJob(jobId);
      if (job.status === "completed") {
        return normalizeDetectedFoods(job.items, jobId);
      }
      if (job.status === "failed") {
        if (inventoryScanJobStorageKey) {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
        }
        setPendingScanJobId(null);
        throw new Error(job.error || "识别失败，请换一张更清晰的图片重试");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("识别仍在后台进行。你可以关闭窗口或退出 App，稍后回到库存页即可继续查看结果。");
  };

  const startScanConversation = async (base64: string, imageUri: string) => {
    if (!review.ready || review.value.pending) throw new Error("请先恢复并重试上次入库，再开始新识别");
    if (base64.length > MAX_AI_IMAGE_BASE64_LENGTH) {
      throw new Error("图片文件过大，请裁剪到只保留订单或商品区域后重试。");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const data = await aiApi.createInventoryScan<{ jobId?: string }>(authFetch, base64, controller.signal);
      if (!data.jobId) throw new Error("AI 识别任务创建失败，请稍后重试");

      setPendingScanJobId(data.jobId);
      if (inventoryScanJobStorageKey) {
        await AsyncStorage.setItem(inventoryScanJobStorageKey, data.jobId);
      }
      setModalVisible(false);
      router.push("/ai-assistant", {
        inventory_scan_job_id: data.jobId,
        inventory_scan_image_uri: imageUri,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("图片上传等待超时，请检查网络后重试。");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  useEffect(() => {
    if (!review.ready) return;
    if (review.value.foods.length || review.value.pending) return;
    setPendingScanJobId(null);
    if (!isAuthenticated || !inventoryScanJobStorageKey) return;
    let active = true;
    const restorePendingScan = async () => {
      const jobId = await AsyncStorage.getItem(inventoryScanJobStorageKey);
      if (!jobId || !active) return;
      setPendingScanJobId(jobId);
      setScanningReceipt(true);
      try {
        const job = await getScanJob(jobId);
        if (!active) return;
        if (job.status === "completed") {
          await presentScanRecognition(normalizeDetectedFoods(job.items, jobId), jobId, () => active);
        } else if (job.status === "failed") {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
          setPendingScanJobId(null);
          Alert.alert("上次图片识别失败", job.error || "请换一张更清晰的图片重试。");
        } else {
          const recognized = await waitForScanJob(jobId);
          if (active) await presentScanRecognition(recognized, jobId, () => active);
        }
      } catch {
        // Keep the job id: a temporary network failure must not discard a recoverable result.
      } finally {
        if (active) setScanningReceipt(false);
      }
    };
    void restorePendingScan();
    return () => { active = false; };
  }, [isAuthenticated, inventoryScanJobStorageKey, review.ready]);

  const presentRecognition = (recognized: DetectedFood[], _openManualForm = false, jobId = pendingScanJobId) => {
    if (recognized.length === 0) {
      Alert.alert("暂未识别到食材", "请确认图片清晰、商品名称可见；你也可以改为手动录入。");
      return;
    }
    const prepared = recognized.map((item) => ({
      ...item,
      source: item.source || pendingIntakeSource,
      expirationDate: item.expirationDate || (item.estimatedExpireDays == null ? "" : suggestedDate(item.estimatedExpireDays)),
    }));
    void review.update({ foods: prepared, batchKey: `inventory-intake-${jobId || Date.now()}`, source: pendingIntakeSource, jobId }).catch(() => undefined);
    setModalVisible(false);
    setBatchReviewVisible(true);
  };

  const lookupBarcode = async (rawBarcode: string) => {
    const barcode = rawBarcode.trim();
    if (!/^\d{8,14}$/.test(barcode) || barcodeLookingUp || scannedBarcodesRef.current.has(barcode)) return;
    scannedBarcodesRef.current.add(barcode);
    setBarcodeLookingUp(true);
    try {
      const food = await foodsApi.barcode<{ name: string; category?: string; barcode: string; brands?: string | null }>(barcode);
      const defaults = inferIngredientDefaults(food.name);
      setDetectedFoods((current) => [...current, {
        id: `barcode-${barcode}`,
        foodName: food.name,
        quantity: "",
        suggestedStorageLocation: defaults.storageLocation,
        estimatedExpireDays: defaults.shelfLifeDays,
        expirationDate: "",
        selected: true,
        source: "barcode",
        confidence: 1,
        barcode,
        missingFields: ["到期日期"],
      }]);
      setBarcodeInput("");
    } catch (error) {
      scannedBarcodesRef.current.delete(barcode);
      Alert.alert("条码暂未识别", error instanceof Error ? error.message : "可改为拍照或手动录入");
    } finally {
      setBarcodeLookingUp(false);
    }
  };

  const openBarcodeScanner = async () => {
    if (!review.ready || review.value.pending) {
      setBatchReviewVisible(true);
      Alert.alert("请先处理上次入库", "确认上次入库结果后再开始新的录入。");
      return;
    }
    if (Platform.OS !== "web" && !cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert("需要相机权限", "拒绝相机权限后仍可在条码录入页手动输入条码。");
      }
    }
    scannedBarcodesRef.current = new Set();
    await review.update({ foods: [], source: "barcode", batchKey: `inventory-intake-barcode-${Date.now()}`, jobId: null });
    setModalVisible(false);
    setBarcodeScannerVisible(true);
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    void lookupBarcode(result.data);
  };

  const openPendingScanResult = async () => {
    if (!pendingScanJobId) return;
    if (review.value.jobId === pendingScanJobId && (review.value.foods.length || review.value.pending)) {
      setBatchReviewVisible(true);
      return;
    }
    setScanningReceipt(true);
    try {
      const job = await getScanJob(pendingScanJobId);
      if (job.status === "completed") {
        await presentScanRecognition(normalizeDetectedFoods(job.items, pendingScanJobId), pendingScanJobId);
      } else if (job.status === "failed") {
        if (inventoryScanJobStorageKey) {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
        }
        setPendingScanJobId(null);
        Alert.alert("图片识别失败", job.error || "请换一张更清晰的图片重试。");
      } else {
        await presentScanRecognition(await waitForScanJob(pendingScanJobId), pendingScanJobId);
      }
    } catch (error) {
      Alert.alert("识别仍在处理中", error instanceof Error ? error.message : "请稍后再查看结果。");
    } finally {
      setScanningReceipt(false);
    }
  };

  const saveDetectedFoods = async () => {
    if (!review.ready || savingDetectedFoods) return;
    const owner = user?.id;
    if (!owner) return;
    const generation = getPrivateStorageGeneration(owner);
    const current = () => recognitionOwner.current === owner && generation === getPrivateStorageGeneration(owner);
    setSavingDetectedFoods(true);
    try {
      const request = review.current.current.pending ?? buildRecognitionIntake(detectedFoods, intakeBatchKey, pendingIntakeSource, review.value.jobId);
      await review.submit(request, async value => {
        await inventoryMutations.bulkIntake.mutateAsync(value);
        if (current() && review.value.jobId && inventoryScanJobStorageKey
          && await AsyncStorage.getItem(inventoryScanJobStorageKey) === review.value.jobId) await AsyncStorage.removeItem(inventoryScanJobStorageKey);
      }, current);
      if (!current()) return;
      await Promise.allSettled(request.items.map(item => addInventoryLog({ foodName: item.food_name, action: "add", quantity: item.quantity, storageLocation: item.storage_location }, owner)));
      if (!current()) return;
      setPendingScanJobId(null);
      setBatchReviewVisible(false);
      Alert.alert("已一键批量入库", `已成功将 ${request.items.length} 种食材导入你的保鲜库！`);
    } catch (error) {
      if (!current()) return;
      Alert.alert("入库结果尚未确认", error instanceof Error ? error.message : "请检查网络后重试原请求。");
    } finally {
      if (current()) setSavingDetectedFoods(false);
    }
  };

  const selectFoodPhoto = async (source: "camera" | "library", useAiAssist = false) => {
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("需要相机权限", "允许相机权限后，即可直接拍摄食材照片。");
          return;
        }
      }

      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.45, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.45, base64: true });
      const asset = result.assets?.[0];
      if (result.canceled || !asset?.base64) return;

      const imageData = `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
      setImageUrl(imageData);
      if (!useAiAssist) return;

      setAiAssisting(true);
      await startScanConversation(asset.base64, asset.uri);
    } catch (error) {
      Alert.alert("图片识别失败", error instanceof Error ? error.message : "请检查网络或重新拍摄一张清晰的食材照片。");
    } finally {
      setAiAssisting(false);
    }
  };

  const openAiFoodAssist = () => {
    if (!review.ready || review.value.pending) {
      setBatchReviewVisible(true);
      Alert.alert("请先处理上次入库", "确认上次入库结果后再开始新的录入。");
      return;
    }
    setPendingIntakeSource("image");
    // React Native 的 Alert 在 Web 端没有稳定的操作按钮支持；浏览器里直接打开相册选择器。
    if (Platform.OS === "web") {
      void selectFoodPhoto("library", true);
      return;
    }
    Alert.alert("AI 辅助录入", "单个食材、购物清单或订单截图都可以。识别出多项时，你可以逐项确认后批量入库。", [
      { text: "取消", style: "cancel" },
      { text: "相册选择", onPress: () => selectFoodPhoto("library", true) },
      { text: "现在拍照", onPress: () => selectFoodPhoto("camera", true) },
    ]);
  };

  const handleScanReceiptAndBatchAdd = async () => {
    try {
      setPendingIntakeSource("receipt");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      setScanningReceipt(true);
      await startScanConversation(result.assets[0].base64, result.assets[0].uri);
    } catch (error) {
      Alert.alert("图片识别失败", error instanceof Error ? error.message : "小票识别过程出现错误");
    } finally {
      setScanningReceipt(false);
    }
  };

  // Recipe State
  const [activeRecipeCategory, setActiveRecipeCategory] = useState("全部");
  const [activeRecipeLibrary, setActiveRecipeLibrary] = useState<"official" | "personal">("official");
  const [recipeSearchQuery, setRecipeSearchQuery] = useState("");
  const [visibleRecipeCount, setVisibleRecipeCount] = useState(12);
  const [recommendationItems, setRecommendationItems] = useState<Array<RecipeRecommendationItem<Recipe>>>([]);
  const [recommendationRequestId, setRecommendationRequestId] = useState<string | null>(null);
  const [recommendationVersion, setRecommendationVersion] = useState("");
  const [recommendationTotal, setRecommendationTotal] = useState(0);
  const [recommendationCursor, setRecommendationCursor] = useState<string | null>(null);
  const [prefetchedRecommendationPage, setPrefetchedRecommendationPage] = useState<RecipeRecommendationPage<Recipe> | null>(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  useEffect(() => {
    setVisibleRecipeCount(12);
  }, [activeRecipeCategory, cookTimeLimit, matchStatusFilter, recipeSearchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void reloadRecipes({
        category: activeRecipeCategory === "全部" || activeRecipeCategory === "冰箱可做"
          ? undefined
          : activeRecipeCategory,
        search: recipeSearchQuery,
        maxCookTime: cookTimeLimit,
        scope: isAuthenticated ? activeRecipeLibrary : "official",
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [activeRecipeCategory, activeRecipeLibrary, cookTimeLimit, isAuthenticated, recipeSearchQuery, reloadRecipes]);

  useEffect(() => {
    if (!isAuthenticated) {
      setRecommendationItems([]);
      setRecommendationRequestId(null);
      setRecommendationCursor(null);
      setPrefetchedRecommendationPage(null);
      setRecommendationTotal(0);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setLoadingRecommendations(true);
      void recommendationsApi.recipes<Recipe>(authFetch, {
        surface: "inventory",
        category: activeRecipeCategory === "全部" ? undefined : activeRecipeCategory,
        search: recipeSearchQuery.trim() || undefined,
        maxCookTime: cookTimeLimit || undefined,
        matchStatus: matchStatusFilter === "完全可做" ? "full"
          : matchStatusFilter === "缺1-2样" ? "missing_few"
            : matchStatusFilter === "优先临期" ? "expiring" : "all",
        pageSize: 24,
      }).then((page) => {
        if (!active) return;
        setRecommendationItems(page.items);
        setRecommendationRequestId(page.requestId);
        setRecommendationVersion(page.scoringVersion);
        setRecommendationCursor(page.nextCursor);
        setRecommendationTotal(page.total);
        setPrefetchedRecommendationPage(null);
        if (page.nextCursor) {
          void recommendationsApi.recipes<Recipe>(authFetch, {
            surface: "inventory", pageSize: 24, cursor: page.nextCursor,
          }).then((nextPage) => {
            if (active) setPrefetchedRecommendationPage(nextPage);
          }).catch(() => undefined);
        }
        void Promise.all(page.items.map((item) => recommendationsApi.event(authFetch, {
          requestId: page.requestId,
          recipeId: item.recipeId,
          eventType: "exposure",
          scoringVersion: page.scoringVersion,
          surface: "inventory",
          idempotencyKey: `inventory-exposure-${page.requestId}-${item.recipeId}`,
        }).catch(() => undefined)));
      }).catch((error) => {
        console.warn("Unified recipe recommendations unavailable", error);
        if (active) setRecommendationItems([]);
      }).finally(() => {
        if (active) setLoadingRecommendations(false);
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [activeRecipeCategory, authFetch, cookTimeLimit, isAuthenticated, matchStatusFilter, recipeSearchQuery]);

  const inventoryCategories = ["全部", "家庭共享", "蔬菜", "肉食", "水果", "乳制品", "粮油干货"];
  const recipeCategories = ["全部", "减脂", "增肌", "营养餐单", "快手菜"];

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const openAddModal = useCallback(() => {
    if (!isAuthenticated) {
      Alert.alert("登录后录入食材", "登录后才能保存和管理你的食材。", [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login", { returnTo: { pathname: "/inventory", params: { action: "add" } } }) },
      ]);
      return;
    }
    setEditingItem(null);
    setFoodName("");
    setCategory("蔬菜");
    setCategoryMenuOpen(false);
    setQuantity("");
    setExpirationDate(dateKeyAfterDays(5));
    setStorageLocation("冷藏");
    setImageUrl("");
    setEntryMode("choose");
    setModalVisible(true);
  }, [isAuthenticated, router]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("open-add-food", () => {
      setActiveSegment("inventory");
      openAddModal();
    });
    return () => sub.remove();
  }, [openAddModal]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("open-add-kitchenware", () => {
      setActiveSegment("kitchenware");
      openKitchenwareModal();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (action !== "add") return;
    setActiveSegment("inventory");
    openAddModal();
    router.setParams({ action: undefined });
  }, [action, openAddModal]);

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setFoodName(item.food_name);
    setCategory(item.category);
    setCategoryMenuOpen(false);
    setQuantity(item.quantity);
    setExpirationDate(item.expiration_date);
    setStorageLocation(item.storage_location);
    setImageUrl(item.image_url || "");
    setEntryMode("manual");
    setModalVisible(true);
  };

  const handleSaveItem = async () => {
    if (!isAuthenticated) {
      setModalVisible(false);
      Alert.alert("请先登录", "登录后才能将食材保存到食材库。", [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (!foodName.trim()) {
      Alert.alert("提示", "请输入食材名称");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        food_name: foodName,
        category,
        quantity: quantity.trim() || "数量未知",
        expiration_date: expirationDate,
        storage_location: storageLocation as StorageLocation,
        image_url: imageUrl.trim() || null,
        ...(!activeHousehold ? quantityFields(quantity) : {}),
        ...(editingItem?.version ? { version: editingItem.version } : {}),
      };

      if (activeHousehold && editingItem) {
        await householdApi.inventoryUpdate(authFetch, activeHousehold.id, editingItem.id, payload);
        await loadFamilyInventory();
      } else if (activeHousehold) {
        await householdApi.inventoryCreate(authFetch, activeHousehold.id, payload);
        await loadFamilyInventory();
      } else if (editingItem) {
        await inventoryMutations.updateInventory.mutateAsync({ id: editingItem.id, input: payload });
        await addInventoryLog({ foodName: payload.food_name, action: "edit", quantity: payload.quantity, storageLocation: payload.storage_location }, user?.id);
      } else {
        await inventoryMutations.createInventory.mutateAsync(payload);
        await addInventoryLog({ foodName: payload.food_name, action: "add", quantity: payload.quantity, storageLocation: payload.storage_location }, user?.id);
      }
      if (!editingItem && pendingScanJobId) {
        if (inventoryScanJobStorageKey) {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
        }
        setPendingScanJobId(null);
      }
      setModalVisible(false);
    } catch (e) {
      Alert.alert("保存失败", e instanceof Error ? e.message : "网络异常，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = (id: number) => {
    Alert.alert("确认删除", "确定要移除该食材吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            if (activeHousehold) {
              await householdApi.inventoryRemove(authFetch, activeHousehold.id, id, items.find(item => item.id === id)?.version ?? 0);
              await loadFamilyInventory();
            } else {
              await inventoryMutations.removeInventory.mutateAsync(id);
            }
            setModalVisible(false);
            setEditingItem(null);
          } catch (e) {
            Alert.alert("移除失败", e instanceof Error ? e.message : "请刷新后重试");
          }
        },
      },
    ]);
  };

  const getStorageLocationAtPoint = useCallback((pageX: number, pageY: number) => {
    return new Promise<StorageLocation | null>((resolve) => {
      const folders = Object.entries(storageFolderRefs.current) as Array<[StorageLocation, View | null]>;
      const measurableFolders = folders.filter(([, folder]) => folder);
      if (measurableFolders.length === 0) {
        resolve(null);
        return;
      }

      let remaining = measurableFolders.length;
      let destination: StorageLocation | null = null;
      measurableFolders.forEach(([location, folder]) => {
        folder?.measureInWindow((x, y, width, height) => {
          if (pageX >= x && pageX <= x + width && pageY >= y && pageY <= y + height) {
            destination = location;
          }
          remaining -= 1;
          if (remaining === 0) resolve(destination);
        });
      });
    });
  }, []);

  const moveItemToStorage = useCallback(async (item: InventoryItem, storageLocation: StorageLocation) => {
    if (item.storage_location === storageLocation) return;

    const previousLocation = item.storage_location;
    setItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, storage_location: storageLocation } : currentItem,
      ),
    );

    try {
      if (activeHousehold) {
        await householdApi.inventoryUpdate(authFetch, activeHousehold.id, item.id, { storage_location: storageLocation,version: item.version });
        await loadFamilyInventory();
      } else {
        await inventoryMutations.updateInventory.mutateAsync({ id: item.id, input: { storage_location: storageLocation } });
      }
    } catch (error) {
      setItems((currentItems) =>
        currentItems.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, storage_location: previousLocation } : currentItem,
        ),
      );
      Alert.alert("移动失败", error instanceof Error ? error.message : "未能更新食材的存放位置，请稍后重试。");
    }
  }, [activeHousehold, authFetch, loadFamilyInventory]);

  const handleItemDrop = useCallback(async (item: InventoryItem, pageX: number, pageY: number) => {
    const destination = await getStorageLocationAtPoint(pageX, pageY);
    longPressedItemId.current = null;
    setDraggedItemId(null);
    dragPan.setValue({ x: 0, y: 0 });
    if (destination) await moveItemToStorage(item, destination);
  }, [dragPan, getStorageLocationAtPoint, moveItemToStorage]);

  const handleItemLongPress = (itemId: number) => {
    longPressedItemId.current = itemId;
    setDraggedItemId(itemId);
    void Haptics.selectionAsync();
  };

  const createItemPanResponder = (item: InventoryItem) => PanResponder.create({
    // 长按已进入拖拽态时，优先由卡片接管手势，避免 ScrollView 抢走上下滑动。
    onMoveShouldSetPanResponderCapture: () => longPressedItemId.current === item.id,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => {
      dragPan.setValue({ x: 0, y: 0 });
      setDraggedItemId(item.id);
    },
    onPanResponderMove: Animated.event(
      [null, { dx: dragPan.x, dy: dragPan.y }],
      { useNativeDriver: false },
    ),
    onPanResponderRelease: (_event, gesture) => {
      void handleItemDrop(item, gesture.moveX, gesture.moveY);
    },
    onPanResponderTerminate: () => {
      longPressedItemId.current = null;
      setDraggedItemId(null);
      dragPan.setValue({ x: 0, y: 0 });
    },
  });

  const handleMaintainKitchenware = async (item: KitchenwareItem) => {
    try {
      await inventoryMutations.maintainKitchenware.mutateAsync(item.id);
      Alert.alert("保养完成", `已更新【${item.name}】的保养记录。`);
    } catch {
      Alert.alert("更新失败", "网络异常，请稍后重试");
    }
  };

  const handleDeleteKitchenware = (item: KitchenwareItem) => {
    Alert.alert("移除厨具", `确定要移除【${item.name}】吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: async () => {
          try {
            await inventoryMutations.removeKitchenware.mutateAsync(item.id);
          } catch {
            Alert.alert("移除失败", "请稍后重试");
          }
        },
      },
    ]);
  };

  // Status helper for inventory items
  const getStatusBadge = (expDate: string) => {
    const diffDays = daysUntilDateKey(expDate);

    if (diffDays === null) {
      return { text: "日期异常", bg: "bg-copy-muted/15", color: "text-copy-muted" };
    } else if (diffDays < 0) {
      return { text: "已过期", bg: "bg-critical/15", color: "text-critical" };
    } else if (diffDays <= 3) {
      return { text: `临期 ${diffDays}天`, bg: "bg-warm/15", color: "text-warm" };
    } else {
      return { text: `新鲜 ${diffDays}天`, bg: "bg-brand/15", color: "text-brand" };
    }
  };

  const filteredItems = filterInventoryItems(items, activeInventoryCategory);
  const expiredItemsForCleanup = getExpiredItems();

  const filteredRecipes = filterAndRankRecipes(recipes, items, activeRecipeCategory, recipeSearchQuery, cookTimeLimit, matchStatusFilter);
  const filteredKitchenware = filterKitchenware(kitchenware, activeKitchenwareCategory);
  const visibleRecipes = filteredRecipes.slice(0, visibleRecipeCount);
  const hasMoreVisibleRecipes = visibleRecipeCount < filteredRecipes.length;

  const handleShowMoreRecipes = async () => {
    if (!hasMoreVisibleRecipes && hasMoreRecipePages) await loadMoreRecipes();
    setVisibleRecipeCount((count) => count + 12);
  };

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}
        refreshControl={<RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            if (refreshInFlight.current) return;
            refreshInFlight.current = true;
            setRefreshing(true);
            void Promise.allSettled([fetchData(), refreshHouseholds()]).finally(() => {
              refreshInFlight.current = false;
              setRefreshing(false);
            });
          }}
          tintColor={colors.brand}
          colors={[colors.brand]}
        />}
        className="bg-canvas"
      >
        {/* 三类资产是页面唯一顶栏，滚动时保持吸顶。 */}
        <InventorySegmentTabs
          active={activeSegment}
          counts={{ inventory: items.length, recipes: recipeTotal, kitchenware: kitchenware.length }}
          onChange={setActiveSegment}
        />

        {sectionErrors[activeSegment] ? (
          <TouchableOpacity
            onPress={() => void fetchData()}
            className="mx-5 mt-3 rounded-2xl border border-warm/30 bg-warm-soft p-3"
          >
            <Text className="text-xs font-bold text-warm">{sectionErrors[activeSegment]} · 点击重试</Text>
          </TouchableOpacity>
        ) : null}

        {/* CONTENT SEGMENT 1: INVENTORY */}
        {activeSegment === "inventory" && (
          <View className="flex-1">
            {!isAuthenticated ? (
              <View className="flex-1 items-center justify-center p-6">
                <View className="w-20 h-20 bg-brand/10 rounded-full items-center justify-center mb-4">
                  <FontAwesome6 name="basket-shopping" size={32} colorClassName="accent-brand" />
                </View>
                <Text className="text-xl font-bold text-ink">解锁智能食材保鲜库</Text>
                <Text className="text-sm text-copy-muted text-center mt-2 mb-6">
                  登录后可随时记录冰箱食材、自动临期提醒并智能生成美味菜单。
                </Text>
                <View>
                  <TouchableOpacity
                    onPress={() => router.push("/login", { returnTo: { pathname: "/inventory", params: { action: "add" } } })}
                    className="bg-brand-fill px-6 py-3 rounded-2xl shadow-sm active:opacity-90"
                  >
                    <Text className="text-sm font-bold text-white">登录并添加食材</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* 🎠 单行极简横向轮播通知卡片集 (Single Swipeable Smart Notice Carousel) */}
                <View className="bg-canvas px-5 pt-4 pb-2">
                  {(() => {
                    const expiredCount = items.filter((i) => getInventoryStatus(i).freshness === "expired").length;
                    const urgentExpiringItems = items.filter((i) => getInventoryStatus(i).freshness === "expiring");
                    const firstUrgentItem = urgentExpiringItems[0];
                    const noticeSlidesCount =
                      (expiredCount > 0 ? 1 : 0) +
                      (urgentExpiringItems.length > 0 ? 1 : (expiredCount > 0 ? 0 : 1)) +
                      1 +
                      (items.length > 0 ? 1 : 0);

                    return (
                      <View>
                        <View>
                        <ScrollView
                          ref={noticeScrollViewRef}
                          horizontal
                          nestedScrollEnabled
                          directionalLockEnabled
                          snapToInterval={noticeCardWidth + 10}
                          snapToAlignment="start"
                          decelerationRate="fast"
                          disableIntervalMomentum
                          showsHorizontalScrollIndicator={false}
                          className="flex-row"
                          contentContainerStyle={{ gap: 10 }}
                          onScrollBeginDrag={() => {
                            noticeLastInteractionAtRef.current = Date.now();
                          }}
                          onMomentumScrollEnd={() => {
                            noticeLastInteractionAtRef.current = Date.now();
                          }}
                          onScroll={(e) => {
                            const offset = e.nativeEvent.contentOffset.x;
                            const index = Math.round(offset / (noticeCardWidth + 10));
                            if (index !== activeNoticeSlide && index >= 0 && index < noticeSlidesCount) {
                              setActiveNoticeSlide(index);
                            }
                          }}
                          scrollEventThrottle={16}
                        >
                          {/* 🚨 Slide A: 红色已过期警告 (单独一页) */}
                          {expiredCount > 0 && (
                            <View style={{ width: noticeCardWidth }}>
                              <View className="flex-row items-center justify-between rounded-[20px] border border-critical/30 bg-danger-soft p-3.5 shadow-2xs">
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-danger-soft">
                                    <FontAwesome6 name="triangle-exclamation" size={13} colorClassName="accent-critical" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="mb-0.5 text-[13px] font-black text-critical">
                                      有 {expiredCount} 种食材已过期
                                    </Text>
                                    <Text numberOfLines={1} className="text-[11px] font-medium text-critical">
                                      及时下架移出，保持食材库新鲜健康
                                    </Text>
                                  </View>
                                </View>
                                <TouchableOpacity
                                  onPress={handleBatchClearExpired}
                                  disabled={clearingExpired}
                                  className="rounded-xl bg-critical-fill px-3 py-1.5 active:bg-critical-fill disabled:opacity-50"
                                >
                                  {clearingExpired ? (
                                    <ActivityIndicator size="small" colorClassName="accent-on-brand" />
                                  ) : (
                                    <Text className="text-xs font-bold text-white">一键清理</Text>
                                  )}
                                </TouchableOpacity>
                              </View>
                            </View>
                          )}

                          {/* ⏰ Slide B: 黄色临期预警 (单独一页) 或 绿包保鲜周报 */}
                          {urgentExpiringItems.length > 0 ? (
                            <View style={{ width: noticeCardWidth }}>
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() =>
                                  router.push({
                                    pathname: "/ai-assistant",
                                    params: {
                                      prefill_food: firstUrgentItem?.food_name || "",
                                      prompt: `我保鲜库里有【${urgentExpiringItems
                                        .map((i) => i.food_name)
                                        .join("、")}】等临期食材，请帮我生成一份今晚就能消耗它们的美味救急餐单！`,
                                    },
                                  })
                                }
                                className="flex-row items-center justify-between rounded-[20px] border border-warm bg-warm-soft p-3.5 active:opacity-90"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-warm-soft">
                                    <FontAwesome6 name="bell" size={12} colorClassName="accent-warm" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="mb-0.5 text-[13px] font-black text-ink">
                                      {urgentExpiringItems.length} 件需要优先处理
                                    </Text>
                                    <Text numberOfLines={1} className="text-[11px] font-medium text-copy-muted">
                                      {firstUrgentItem?.food_name}{urgentExpiringItems.length > 1 ? "等食材临近到期" : "临近到期"}
                                    </Text>
                                  </View>
                                </View>

                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-warm">去处理</Text>
                                  <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-warm" />
                                </View>
                              </TouchableOpacity>
                            </View>
                          ) : expiredCount === 0 ? (
                            <View style={{ width: noticeCardWidth }}>
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() =>
                                  router.push({
                                    pathname: "/ai-assistant",
                                    params: { prompt: "帮我用冰箱库现有食材搭配一份健康营养的餐单" },
                                  })
                                }
                                className="flex-row items-center justify-between rounded-[20px] border border-brand bg-brand-soft p-3.5"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="w-9 h-9 rounded-xl bg-surface/70 items-center justify-center">
                                    <FontAwesome6 name="heart-pulse" size={14} colorClassName="accent-brand" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="text-xs font-black text-ink mb-0.5">智能保鲜周报</Text>
                                    <Text className="text-[11px] text-copy-muted font-medium">
                                      全库 {items.length} 件食材均在最佳赏味期
                                    </Text>
                                  </View>
                                </View>
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">去配餐</Text>
                                  <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-brand" />
                                </View>
                              </TouchableOpacity>
                            </View>
                          ) : null}

                          {/* Slide C: 📸 AI 拍照小票/食材一键入库 */}
                          <View style={{ width: noticeCardWidth }}>
                            <TouchableOpacity
                              onPress={pendingScanJobId ? openPendingScanResult : handleScanReceiptAndBatchAdd}
                              disabled={scanningReceipt}
                              className="bg-background-secondary p-3.5 rounded-[20px] flex-row items-center justify-between active:opacity-90"
                            >
                              <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                <View className="w-10 h-10 rounded-2xl bg-brand-soft items-center justify-center">
                                  <FontAwesome6 name="receipt" size={14} colorClassName="accent-brand" />
                                </View>
                                <View className="flex-1">
                                  <Text className="text-[13px] font-black text-ink mb-0.5">{pendingScanJobId ? "上次识别结果待确认" : "AI 拍照小票/食材一键入库"}</Text>
                                  <Text className="text-[11px] text-copy-muted">{pendingScanJobId ? "点此继续查看并确认入库" : "自动识别食材名分量与建议保质期"}</Text>
                                </View>
                              </View>
                              {scanningReceipt ? (
                                <ActivityIndicator size="small" colorClassName="accent-ink" />
                              ) : pendingScanJobId ? (
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">查看</Text>
                                  <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-brand" />
                                </View>
                              ) : (
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">拍照</Text>
                                  <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-brand" />
                                </View>
                              )}
                            </TouchableOpacity>
                          </View>

                          {/* Slide D: 🪄 现有食材极速烹饪匹配 */}
                          {items.length > 0 && (
                            <View style={{ width: noticeCardWidth }}>
                              <TouchableOpacity
                                onPress={() =>
                                  router.push({
                                    pathname: "/ai-assistant",
                                    params: { prompt: "帮我用冰箱库现有食材搭配一份减脂晚餐食谱" },
                                  })
                                }
                                className="bg-brand-soft p-3.5 rounded-[20px] flex-row items-center justify-between"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="w-10 h-10 rounded-2xl bg-surface/70 items-center justify-center">
                                    <FontAwesome6 name="wand-magic-sparkles" size={14} colorClassName="accent-brand" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="text-[13px] font-black text-ink mb-0.5">现有食材极速烹饪匹配</Text>
                                    <Text className="text-[11px] text-copy-muted">用现有 {items.length} 种食材极速匹配食谱</Text>
                                  </View>
                                </View>
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">去匹配</Text>
                                  <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-brand" />
                                </View>
                              </TouchableOpacity>
                            </View>
                          )}
                        </ScrollView>
                        </View>

                        {/* 轮播指示点 */}
                        <View className="flex-row items-center justify-center gap-1.5 mt-2">
                          {Array.from({ length: noticeSlidesCount }).map((_, idx) => (
                            <View
                              key={idx}
                              className={`h-1 rounded-full ${
                                activeNoticeSlide === idx ? "w-3.5 bg-brand-fill" : "w-1 bg-background-secondary"
                              }`}
                            />
                          ))}
                        </View>
                      </View>
                    );
                  })()}
                </View>

                {/* Category Slider & Smart Storage Filter (Wrapped in White Bento Card Container) */}
                <View className="px-5 pt-2 pb-3">
                  <View className="bg-surface rounded-[24px] p-4 border border-line shadow-2xs">
                    <View className="mb-3 flex-row items-center justify-between px-0.5">
                      <View className="flex-row items-center gap-2">
                        <View className="w-6 h-6 rounded-lg bg-brand/10 items-center justify-center">
                          <FontAwesome6 name="sliders" size={10} colorClassName="accent-brand" />
                        </View>
                        <Text className="text-[12px] font-black text-ink">按位置或品类查看</Text>
                      </View>

                      <TouchableOpacity
                        onPress={openHistoryModal}
                        className="flex-row items-center gap-1.5 rounded-full border border-line bg-background-secondary px-2.5 py-1 active:bg-background-secondary"
                      >
                        <FontAwesome6 name="clock-rotate-left" size={10} colorClassName="accent-copy-muted" />
                        <Text className="text-[10px] font-bold text-copy-muted">操作历史</Text>
                      </TouchableOpacity>
                    </View>

                    <View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        className="flex-row"
                        contentContainerStyle={{ gap: 8 }}
                      >
                      {["全部", "冷藏库", "冷冻库", "常温库", "位置待确认", "蔬菜", "肉食", "水果", "乳制品", "粮油干货"].map((cat) => {
                        const cleanCat = cat.split(" ")[0];
                        const isActive = activeInventoryCategory === cleanCat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => setActiveInventoryCategory(cleanCat)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isActive }}
                            className={`rounded-full border px-3 py-1.5 ${
                              isActive
                                ? "border-brand bg-brand-fill"
                                : "border-line bg-background-secondary"
                            }`}
                          >
                            <Text
                              className={`text-xs ${
                                isActive ? "font-black text-white" : "font-semibold text-copy-muted"
                              }`}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      </ScrollView>
                    </View>
                  </View>
                </View>

                {/* 保鲜分区：由页面主滚动容器统一承载，避免底部导航遮挡嵌套列表 */}
                <View className="px-4 pt-3">
                  {loadingItems ? (
                    <View className="py-16 items-center">
                      <ActivityIndicator size="large" colorClassName="accent-brand" />
                    </View>
                  ) : filteredItems.length === 0 ? (
                    <View className="py-16 items-center bg-surface/60 rounded-[28px] border border-line p-6">
                      <FontAwesome6 name="snowflake" size={36} colorClassName="accent-warm" />
                      <Text className="text-base font-bold text-ink mt-3">保鲜仓暂无此类食材</Text>
                      <Text className="text-xs text-copy-muted mt-1">点击右上角“录入食材”添加食材到冰箱吧！</Text>
                    </View>
                  ) : (
                    <View>
                      {buildInventoryStorageGroups(filteredItems).map((group) => {
                        // 若过滤了特定分类，允许无食材的大文件夹隐藏
                        if (group.items.length === 0 && (activeInventoryCategory !== "全部" || group.key === "位置待确认")) return null;

                        return (
                          <View
                            key={group.key}
                            ref={(node) => {
                              if (group.key !== "位置待确认") storageFolderRefs.current[group.key as StorageLocation] = node;
                            }}
                            className={`mb-4 rounded-[26px] border p-4 ${group.folderBg}`}
                          >
                            {/* 手机系统大文件夹 标题 Header */}
                            <View className="flex-row items-center justify-between mb-3 px-1">
                              <View className="flex-1 flex-row items-center gap-2.5 pr-2">
                                <View className={`h-10 w-10 items-center justify-center rounded-2xl ${group.iconBg}`}>
                                  <FontAwesome6 name={group.icon as any} size={14} colorClassName={group.iconColorClass} />
                                </View>
                                <View>
                                  <Text className="text-[15px] font-black text-ink">{group.title}</Text>
                                  <Text className="text-[11px] text-copy-muted font-medium mt-0.5">{group.subtitle}</Text>
                                </View>
                              </View>

                              <View className="flex-row items-center gap-2">
                                <View className="bg-background-secondary px-2.5 py-1 rounded-full">
                                  <Text className="text-[11px] font-bold text-copy-muted">
                                    {group.items.length} 项
                                  </Text>
                                </View>
                                {group.key !== "位置待确认" && <TouchableOpacity
                                  onPress={() => {
                                    setStorageLocation(group.key);
                                    openAddModal();
                                  }}
                                  accessibilityLabel={`存入${group.key}食材`}
                                  className="h-9 w-9 items-center justify-center rounded-full bg-brand-fill active:opacity-80"
                                >
                                  <FontAwesome6 name="plus" size={11} colorClassName="accent-on-brand" />
                                </TouchableOpacity>}
                              </View>
                            </View>

                            {/* 手机系统大文件夹核心：App 图标式多列网格 (Grid Layout) */}
                            {group.items.length === 0 ? (
                              <View className="py-6 items-center bg-surface/60 rounded-[22px] border border-dashed border-line">
                                <Text className="text-xs text-copy-muted">文件夹空空如也，点击右上角 + 入库</Text>
                              </View>
                            ) : (
                              <View
                                className="flex-row flex-wrap gap-2.5"
                                onLayout={(event) => {
                                  const nextWidth = Math.floor(event.nativeEvent.layout.width);
                                  if (nextWidth !== inventoryGridWidth) setInventoryGridWidth(nextWidth);
                                }}
                              >
                                {group.items.map((item) => {
                                  const status = getInventoryStatus(item);
                                  const badge = getExpirationBadgeConfig(status);

                                  return (
                                    <Animated.View
                                      key={item.id}
                                      {...createItemPanResponder(item).panHandlers}
                                      style={[
                                        { width: inventoryCardWidth || "48%" },
                                        draggedItemId === item.id && {
                                          zIndex: 30,
                                          elevation: 30,
                                          opacity: 0.92,
                                          transform: [...dragPan.getTranslateTransform(), { scale: 1.04 }],
                                        },
                                      ]}
                                      className={`relative min-h-[154px] items-start overflow-hidden rounded-[20px] border bg-brand-soft p-3 ${Number(highlightItemId) === item.id ? "border-warm/30" : "border-line"}`}
                                    >
                                      {/* 点击查看详情；长按可拖动到其他保鲜分区 */}
                                      <TouchableOpacity
                                        activeOpacity={0.8}
                                        delayLongPress={250}
                                        onLongPress={() => handleItemLongPress(item.id)}
                                        onPress={() => {
                                          if (longPressedItemId.current === item.id) {
                                            longPressedItemId.current = null;
                                            setDraggedItemId(null);
                                            return;
                                          }
                                          openEditModal(item);
                                        }}
                                        accessibilityLabel={`${item.food_name}，${formatInventoryQuantity(item.quantity)}，${badge.label}`}
                                        className="w-full items-start"
                                      >
                                        <View className="w-full flex-row items-start justify-between">
                                          {item.image_url ? (
                                            <Image
                                              source={{ uri: item.image_url }}
                                              className="h-12 w-12 rounded-2xl bg-brand-soft"
                                            />
                                          ) : (
                                            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
                                              <FontAwesome6 name="lemon" size={19} colorClassName="accent-brand" />
                                            </View>
                                          )}
                                          <View className={`ml-2 rounded-full px-2 py-1 ${badge.badgeBg}`}>
                                            <Text className={`text-[9px] font-black ${badge.textColor}`}>{badge.label}</Text>
                                          </View>
                                        </View>

                                        <Text
                                          numberOfLines={2}
                                          className="mt-2.5 min-h-[34px] text-[13px] font-black leading-[17px] text-ink"
                                        >
                                          {item.food_name}
                                        </Text>
                                        <View className="mt-2 flex-row items-center gap-1.5">
                                          <FontAwesome6 name="weight-scale" size={9} colorClassName="accent-copy-muted" />
                                          <Text className="text-[11px] font-semibold text-copy-muted">{formatInventoryQuantity(item.quantity)}</Text>
                                        </View>
                                      </TouchableOpacity>
                                    </Animated.View>
                                  );
                                })}

                                {/* 结尾智能 + 入库网格槽位 (类似于手机大文件夹里的 + 按钮) */}
                                {group.key !== "位置待确认" && <TouchableOpacity
                                  onPress={() => {
                                    setStorageLocation(group.key);
                                    openAddModal();
                                  }}
                                  style={{ width: inventoryCardWidth || "48%" }}
                                  className="min-h-[146px] items-center justify-center rounded-[20px] border border-dashed border-line bg-surface p-3 active:bg-surface"
                                >
                                  <View className="mb-2 h-10 w-10 items-center justify-center rounded-full bg-background-secondary">
                                    <FontAwesome6 name="plus" size={14} colorClassName="accent-copy-muted" />
                                  </View>
                                  <Text className="text-[11px] font-black text-copy-muted">存入{group.key}</Text>
                                  <Text className="mt-1 text-[9px] text-copy-muted">拍照或手动录入</Text>
                                </TouchableOpacity>}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </>
            )}
          </View>
        )}
        {activeSegment === "recipes" && (
          <View className="flex-1 pt-3">
            {/* Search Input & Filter (Wrapped in White Bento Card Container) */}
            <View className="mx-5 mb-4 rounded-[24px] border border-line bg-surface p-4 shadow-2xs">
              {/* Bento Card Header: 标题与投稿收藏按钮 */}
              <View className="mb-3 flex-row items-center justify-between pb-3 border-b border-line">
                <View className="flex-1 pr-2">
                  <View className="flex-row items-center gap-2">
                    <View className="w-6 h-6 rounded-lg bg-brand/10 items-center justify-center">
                      <FontAwesome6 name="utensils" size={11} colorClassName="accent-brand" />
                    </View>
                    <Text className="text-[14px] font-black text-ink">今天想吃什么？</Text>
                  </View>
                  <Text className="mt-0.5 text-[10px] font-medium text-copy-muted">优先展示与你保鲜库食材更匹配的菜谱</Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push("/recipe-submit")}
                  className="flex-row items-center rounded-full border border-line bg-brand-soft px-3 py-1.5 active:opacity-80"
                >
                  <FontAwesome6 name="pen" size={10} colorClassName="accent-brand" />
                  <Text className="ml-1.5 text-[10px] font-black text-brand">投稿与收藏</Text>
                </TouchableOpacity>
              </View>

              <View className="mb-2 flex-row rounded-xl bg-background-secondary p-1">
                {([
                  { key: "official" as const, label: "官方库", count: isAuthenticated ? recipeLibrarySummary.official : recipeTotal },
                  { key: "personal" as const, label: "我的食谱", count: recipeLibrarySummary.personal },
                ]).map((library) => (
                  <TouchableOpacity
                    key={library.key}
                    disabled={!isAuthenticated && library.key === "personal"}
                    onPress={() => setActiveRecipeLibrary(library.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: activeRecipeLibrary === library.key, disabled: !isAuthenticated && library.key === "personal" }}
                    className={`flex-1 flex-row items-center justify-center rounded-lg px-2 py-2 ${
                      activeRecipeLibrary === library.key ? "bg-surface shadow-xs" : "bg-transparent"
                    } ${!isAuthenticated && library.key === "personal" ? "opacity-45" : ""}`}
                  >
                    <Text className={`text-[11px] ${activeRecipeLibrary === library.key ? "font-black text-brand" : "font-bold text-copy-muted"}`}>
                      {library.label} · {library.count}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View className="mb-3 flex-row items-center justify-between rounded-xl bg-background-secondary px-3 py-2">
                <Text className="text-[11px] font-bold text-ink">{activeRecipeLibrary === "official" ? "平台审核食谱" : "投稿与收藏"}</Text>
                <Text className="text-[10px] text-copy-muted">
                  已加载 {recipes.length} / 共 {recipeTotal} 道
                </Text>
              </View>

              {/* Search Bar */}
              <View className="flex-row items-center rounded-xl border border-line/80 bg-background-secondary px-3.5 py-2.5 mb-3">
                <FontAwesome6 name="magnifying-glass" size={13} colorClassName="accent-copy-muted" className="mr-2" />
                <TextInput
                  value={recipeSearchQuery}
                  onChangeText={setRecipeSearchQuery}
                  placeholder="搜索菜名、食材或营养目标"
                  placeholderTextColorClassName="accent-copy-muted"
                  className="flex-1 text-[13px] text-ink py-0"
                />
                {recipeSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setRecipeSearchQuery("")}>
                    <FontAwesome6 name="xmark" size={13} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Recipe Filter Categories */}
              <View className="gap-2.5">
                <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}
                    className="flex-row"
                  >
                    {["全部", "冰箱全可做", "减脂低卡", "增肌高蛋白", "15分钟快手菜"].map((cat) => {
                      const cleanCat = cat.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, "");
                      const isActive =
                        activeRecipeCategory === cleanCat ||
                        (cat.includes("冰箱") && activeRecipeCategory === "冰箱可做") ||
                        (cat === "全部" && activeRecipeCategory === "全部");
                      return (
                        <TouchableOpacity
                          key={cat}
                          onPress={() => {
                            if (cat.includes("冰箱")) setActiveRecipeCategory("冰箱可做");
                            else if (cat.includes("减脂")) setActiveRecipeCategory("减脂");
                            else if (cat.includes("增肌")) setActiveRecipeCategory("增肌");
                            else if (cat.includes("快手")) setActiveRecipeCategory("快手菜");
                            else setActiveRecipeCategory("全部");
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isActive }}
                          className={`rounded-full border px-3 py-1.5 ${
                            isActive
                              ? "border-brand bg-brand-fill"
                              : "border-line bg-background-secondary"
                          }`}
                        >
                          <Text
                            className={`text-xs ${
                              isActive ? "font-black text-white" : "font-semibold text-copy-muted"
                            }`}
                          >
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* Quick Filter Pills */}
                <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}
                    className="flex-row"
                  >
                    {[
                      { label: "全部时间", limit: 0 },
                      { label: "15分快手", limit: 15 },
                      { label: "30分内", limit: 30 },
                    ].map((timeOption) => (
                      <TouchableOpacity
                        key={timeOption.limit}
                        onPress={() => setCookTimeLimit(timeOption.limit)}
                        className={`rounded-full border px-3 py-1 ${
                          cookTimeLimit === timeOption.limit
                            ? "border-brand/40 bg-brand/10"
                            : "border-line bg-background-secondary"
                        }`}
                      >
                        <Text
                          className={`text-[11px] ${
                            cookTimeLimit === timeOption.limit ? "font-bold text-brand" : "text-copy-muted"
                          }`}
                        >
                          {timeOption.label}
                        </Text>
                      </TouchableOpacity>
                    ))}

                    <View className="h-4 w-px bg-line self-center mx-0.5" />

                    {[
                      { label: "匹配全部", key: "全部" },
                      { label: "完全可做", key: "完全可做" },
                      { label: "缺1-2样", key: "缺1-2样" },
                      { label: "优先临期", key: "优先临期" },
                    ].map((statusOption) => (
                      <TouchableOpacity
                        key={statusOption.key}
                        onPress={() => setMatchStatusFilter(statusOption.key)}
                        className={`rounded-full border px-3 py-1 ${
                          matchStatusFilter === statusOption.key
                            ? "border-warm/30 bg-warm-soft"
                            : "border-line bg-background-secondary"
                        }`}
                      >
                        <Text
                          className={`text-[11px] ${
                            matchStatusFilter === statusOption.key ? "font-bold text-warm" : "text-copy-muted"
                          }`}
                        >
                          {statusOption.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </View>

            {/* Recipe List: 2-Column Waterfall Bento Cards */}
            <View className="px-4 pb-4 pt-1">
              {loadingRecipes ? (
                <View className="py-16 items-center">
                  <ActivityIndicator size="large" colorClassName="accent-brand" />
                </View>
              ) : filteredRecipes.length === 0 ? (
                <View className="py-16 items-center bg-surface/60 rounded-[28px] border border-line p-6">
                  <FontAwesome6 name="utensils" size={36} colorClassName="accent-warm" />
                  <Text className="mt-3 text-base font-bold text-ink">
                    {activeRecipeCategory === "冰箱可做" ? "暂时没有库存可做的食谱" : "未找到符合条件的食谱"}
                  </Text>
                  <Text className="mt-1 text-center text-xs text-copy-muted">
                    尝试重置筛选条件，或拍照录入更多冰箱食材
                  </Text>
                </View>
              ) : (
                <View className="flex-row flex-wrap justify-between gap-y-3.5">
                  {visibleRecipes.map((recipe) => {
                    const localAnalysis = analyzeRecipeInventoryMatch(recipe, items, { healthProfile, kitchenware });
                    const recommendation = recommendationItems.find((item) => item.recipeId === recipe.id);
                    const uncertainQuantity = !recommendation || !Array.isArray(recommendation.features.uncertainIngredients) || !!recommendation.features.uncertainIngredients?.length
                      || recommendation.degraded.includes("inventory_quantity_unknown");
                    const analysis = recommendation ? { ...localAnalysis,
                      matchedIngredients: recommendation.features.matchedIngredients,
                      missingIngredients: recommendation.features.missingIngredients,
                      expiringIngredients: recommendation.features.expiringIngredients,
                      coveragePercent: recommendation.features.inventoryCoverage,
                      matchStatus: !uncertainQuantity && recommendation.features.inventoryCoverage === 100 ? "full" as const : "partial" as const,
                      availableSubstitutes: [],
                    } : localAnalysis;
                    const expiringMatch = analysis.expiringIngredients[0];

                    return (
                      <View
                        key={recipe.id}
                        style={{ width: "48.5%" }}
                        className="flex-col justify-between overflow-hidden rounded-[22px] border border-line bg-surface active:opacity-95"
                      >
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPressIn={() => void recipesApi.prefetchDetail(recipe.id).catch(() => undefined)}
                          onPress={() => {
                            if (recommendation && recommendationRequestId) {
                              void recommendationsApi.event(authFetch, {
                                requestId: recommendationRequestId,
                                recipeId: recipe.id,
                                eventType: "view",
                                scoringVersion: recommendationVersion,
                                surface: "inventory",
                                idempotencyKey: `inventory-view-${recommendationRequestId}-${recipe.id}`,
                              }).catch(() => undefined);
                            }
                            router.push("/recipe-detail", { id: recipe.id, recommendationRequestId: recommendation ? recommendationRequestId ?? undefined : undefined });
                          }}
                        >
                          <View className="relative">
                            <RecipeCover
                              uri={recipe.image_url}
                              className="h-32 w-full"
                              placeholderClassName="h-32 w-full items-center justify-center bg-brand-soft"
                            />
                            {/* 卡路里胶囊 */}
                            <View className="absolute top-2 right-2 flex-row items-center gap-1 rounded-full bg-black/60 px-2 py-0.5">
                              <FontAwesome6 name="fire" size={9} colorClassName="accent-highlight" />
                              <Text className="text-[10px] font-black text-white">
                                {recipe.calories == null ? '营养待补全' : `${recipe.nutrition_is_estimated ? '约' : ''}${recipe.calories} kcal`}
                              </Text>
                            </View>

                            {/* 冰箱食材匹配角标 (左下角: 优先展示临期 > 完全可做 > 缺少X种) */}
                            {uncertainQuantity ? (
                              <View className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-0.5"><Text className="text-[9px] font-bold text-amber-200">原料用量待核对</Text></View>
                            ) : expiringMatch ? (
                              <View className="absolute bottom-2 left-2 flex-row items-center gap-1 rounded-full bg-warm-fill px-2 py-0.5 shadow-2xs">
                                <FontAwesome6 name="clock-rotate-left" size={8} colorClassName="accent-on-brand" />
                                <Text className="text-[9px] font-black text-white">
                                  优先消耗 {expiringMatch.name} (剩{expiringMatch.daysLeft}天)
                                </Text>
                              </View>
                            ) : analysis.matchStatus === "full" ? (
                              <View className="absolute bottom-2 left-2 rounded-full bg-brand-fill px-2 py-0.5 shadow-2xs">
                                <Text className="text-[9px] font-black text-white">已知原料足量</Text>
                              </View>
                            ) : analysis.missingIngredients.length > 0 ? (
                              <View className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-0.5">
                                <Text className="text-[9px] font-bold text-amber-200">
                                  缺 {analysis.missingIngredients.length} 种
                                </Text>
                              </View>
                            ) : (
                              <View className="absolute bottom-2 left-2 rounded-full bg-black/40 px-2 py-0.5">
                                <Text className="text-[9px] font-bold text-white">{recipe.category}</Text>
                              </View>
                            )}
                          </View>

                          <View className="p-3 pb-2.5">
                            {recipe.nutrition_is_estimated ? <Text className="mb-1 text-[9px] font-black text-warm">营养估算</Text> : null}
                            <Text className="mb-1 text-[9px] font-black text-brand">库存覆盖 {analysis.coveragePercent}%</Text>
                            <Text numberOfLines={2} className="min-h-[36px] text-sm font-black leading-[18px] text-ink">
                              {recipe.title}
                            </Text>
                            <Text className="mt-1 min-h-[32px] text-[10px] font-medium leading-4 text-copy-muted" numberOfLines={2}>
                              {recipe.description}
                            </Text>
                            {recommendation ? (
                              <Text className="mt-1.5 text-[9px] font-bold text-brand" numberOfLines={2}>
                                推荐依据：{recommendation.reasons.join("；")} · {recommendation.scoringVersion}
                              </Text>
                            ) : null}

                            {/* 缺失/已有食材标签提醒 */}
                            {analysis.missingIngredients.length > 0 ? (
                              <Text className="mt-1.5 text-[10px] font-medium text-warm" numberOfLines={1}>
                                缺: {analysis.missingIngredients.map((i) => i.name).slice(0, 2).join("、")}
                              </Text>
                            ) : analysis.matchedIngredients.length > 0 ? (
                              <Text className="mt-1.5 text-[10px] font-medium text-brand" numberOfLines={1}>
                                {recommendation ? "已知足量" : "名称匹配"}: {analysis.matchedIngredients.map((i) => i.name).slice(0, 2).join("、")}
                              </Text>
                            ) : null}
                            {analysis.availableSubstitutes.length ? (
                              <Text className="mt-1 text-[9px] font-bold text-brand" numberOfLines={1}>
                                可替代：{analysis.availableSubstitutes.map((item) => `${item.missing}→${item.substitute}`).join("、")}
                              </Text>
                            ) : null}
                            {analysis.healthConflicts.length ? (
                              <Text className="mt-1 text-[9px] font-black text-critical" numberOfLines={2}>
                                健康冲突：{analysis.healthConflicts.map((risk) => `${risk.name}（${risk.severity === "severe" ? "严重" : "需确认"}）`).join("、")}
                              </Text>
                            ) : null}
                            {analysis.missingKitchenware.length ? (
                              <Text className="mt-1 text-[9px] font-black text-critical" numberOfLines={1}>缺厨具：{analysis.missingKitchenware.join("、")}</Text>
                            ) : null}

                            <View className="mt-2 flex-row items-center gap-1.5">
                              <FontAwesome6 name="clock" size={9} colorClassName="accent-copy-muted" />
                              <Text className="text-[9px] font-bold text-copy-muted">{recipe.cook_time == null ? '用时未标注' : `${recipe.cook_time} 分钟`}</Text>
                              <View className="h-1 w-1 rounded-full bg-background-secondary" />
                              <Text className="text-[9px] font-bold text-brand">蛋白 {recipe.protein}g</Text>
                            </View>
                            <Text className="mt-1 text-[8px] text-copy-muted" numberOfLines={1}>
                              规则匹配 · {analysis.dataUpdatedAt ? `库存更新于 ${new Date(analysis.dataUpdatedAt).toLocaleDateString()}` : "基于当前库存快照"}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {/* 底部快捷操作 */}
                        <View className="px-3 pb-3">
                          {analysis.missingIngredients.length > 0 ? (
                            <TouchableOpacity
                              onPress={() => handleAddMissingFromCard(recipe.title, analysis.missingIngredients)}
                              className="flex-row items-center justify-center gap-1 rounded-xl bg-warm-soft border border-warm/30 py-2 active:opacity-80"
                            >
                              <FontAwesome6 name="cart-plus" size={9} colorClassName="accent-warm" />
                              <Text className="text-[10px] font-black text-warm">补齐缺料到采购单</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() =>
                                router.push({
                                  pathname: "/ai-assistant",
                                  params: {
                                    prompt: `请作为我的私厨，为我指导烹饪【${recipe.title}】的详细步骤、调料配比与注意事项。`,
                                  },
                                })
                              }
                              className="flex-row items-center justify-center gap-1.5 rounded-xl bg-brand-soft py-2 active:opacity-80"
                            >
                              <FontAwesome6 name="wand-magic-sparkles" size={9} colorClassName="accent-brand" />
                              <Text className="text-[10px] font-black text-brand">AI 烹饪指导</Text>
                            </TouchableOpacity>
                          )}
                          <View className="mt-2 flex-row gap-1.5">
                            <TouchableOpacity
                              onPress={() => void handleRecipeExecution(recipe, analysis)}
                              disabled={analysis.blocked}
                              className="flex-1 items-center rounded-xl bg-background-secondary py-2 disabled:opacity-40"
                            >
                              <Text className="text-[9px] font-black text-copy-muted">加入队列</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => void handleRecipeExecution(recipe, analysis, true)}
                              disabled={analysis.blocked || analysis.missingIngredients.length > 0 || uncertainQuantity}
                              className="flex-1 items-center rounded-xl bg-brand-fill py-2 disabled:opacity-40"
                            >
                              <Text className="text-[9px] font-black text-white">直接开做</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {(hasMoreVisibleRecipes || hasMoreRecipePages) && (
                    <View className="w-full items-center pt-1">
                      <TouchableOpacity
                        onPress={() => void handleShowMoreRecipes()}
                        disabled={loadingMoreRecipes || loadingRecommendations}
                        className="flex-row items-center gap-2 rounded-full border border-line bg-surface px-6 py-3"
                      >
                        {loadingMoreRecipes || loadingRecommendations ? <ActivityIndicator size="small" colorClassName="accent-brand" /> : null}
                        <Text className="text-xs font-black text-copy-muted">
                          {hasMoreVisibleRecipes ? "再看 12 道" : "加载更多推荐"}
                        </Text>
                        {!loadingMoreRecipes && !loadingRecommendations ? <FontAwesome6 name="chevron-down" size={9} colorClassName="accent-copy-muted" /> : null}
                      </TouchableOpacity>
                      <Text className="mt-2 text-[10px] text-copy-muted">
                        当前筛选展示 {visibleRecipes.length} 道 · 当前库共 {recipeTotal} 道
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        <KitchenwareSection
          active={activeSegment === "kitchenware"}
          isAuthenticated={isAuthenticated}
          items={kitchenware}
          filteredItems={filteredKitchenware}
          starterKits={KITCHENWARE_STARTER_KITS}
          addingStarterKit={addingStarterKit}
          activeCategory={activeKitchenwareCategory}
          loading={loadingKitchenware}
          onLogin={() => router.push("/login")}
          onAddStarterKit={(kit) => void addStarterKit(kit)}
          onCategoryChange={setActiveKitchenwareCategory}
          onOpenEditor={openKitchenwareModal}
          onDelete={handleDeleteKitchenware}
          onMaintain={(item) => void handleMaintainKitchenware(item)}
          onRequestRecipes={(item) => router.push({
            pathname: "/ai-assistant",
            params: { prompt: `请为我的【${item.name}】推荐 3 道专属极速美味食谱，附带所需食材与操作技巧！` },
          })}
        />

        {/* 全屏录入页：避免小屏设备上的底部弹层拥挤，底部主操作始终可达。 */}
        <Modal
          visible={modalVisible && isAuthenticated}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className="flex-1 bg-canvas"
            style={{ paddingTop: insets.top }}
          >
            <View className="border-b border-line bg-surface">
              <View className="h-14 w-full max-w-[720px] self-center flex-row items-center px-4">
                <View className="w-[84px] items-start">
                  <TouchableOpacity
                    onPress={() => setModalVisible(false)}
                    accessibilityLabel="关闭食材录入页面"
                    className="h-9 w-9 items-center justify-center rounded-full bg-canvas active:opacity-70"
                  >
                    <FontAwesome6 name="xmark" size={15} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-[16px] font-black text-ink">
                    {editingItem ? "编辑食材" : entryMode === "choose" ? "添加食材" : "新建食材"}
                  </Text>
                </View>
                <View className="w-[84px] items-end">
                  {!editingItem && entryMode === "manual" ? (
                    <TouchableOpacity
                      onPress={() => setEntryMode("choose")}
                      accessibilityLabel="切换到智能录入"
                      className="h-9 flex-row items-center gap-1.5 px-1 active:opacity-70"
                    >
                      <FontAwesome6 name="wand-magic-sparkles" size={10} colorClassName="accent-brand" />
                      <Text className="text-[11px] font-black text-brand">AI 录入</Text>
                    </TouchableOpacity>
                  ) : (
                    <View className="h-9" />
                  )}
                </View>
              </View>
            </View>

            {!editingItem && entryMode === "choose" ? (
              <ScrollView
                className="flex-1"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
              >
                <View className="w-full max-w-[680px] self-center px-5 pb-6 pt-5">
                  <View className="mb-4">
                    <Text className="text-[26px] font-black leading-8 text-ink">怎么添加更方便？</Text>
                    <Text className="mt-2 text-sm leading-6 text-copy-muted">拍一张照片自动识别，或用不到一分钟手动填好。</Text>
                  </View>

                  <TouchableOpacity
                    onPress={openAiFoodAssist}
                    disabled={aiAssisting}
                    className="min-h-[190px] overflow-hidden rounded-[28px] bg-brand-fill p-6 active:opacity-90 disabled:opacity-60"
                  >
                    <View className="absolute -right-10 -top-12 h-44 w-44 rounded-full bg-surface/10" />
                    <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface/15">
                      {aiAssisting ? <ActivityIndicator colorClassName="accent-on-brand" /> : <FontAwesome6 name="camera" size={19} colorClassName="accent-on-brand" />}
                    </View>
                    <View className="mt-8 flex-row items-end justify-between gap-4">
                      <View className="flex-1">
                        <Text className="text-lg font-black text-white">{aiAssisting ? "AI 正在识别…" : "拍照智能录入"}</Text>
                        <Text className="mt-1.5 text-xs leading-5 text-emerald-50">自动识别名称、数量、存放位置和建议到期日</Text>
                      </View>
                      {!aiAssisting && (
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface/15">
                          <FontAwesome6 name="arrow-right" size={14} colorClassName="accent-on-brand" />
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={openBarcodeScanner}
                    className="mt-4 flex-row items-center rounded-[24px] border border-line bg-surface p-4 active:opacity-80"
                  >
                    <View className="h-12 w-12 items-center justify-center rounded-2xl bg-warm-soft">
                      <FontAwesome6 name="barcode" size={17} colorClassName="accent-warm" />
                    </View>
                    <View className="ml-4 flex-1">
                      <Text className="text-[15px] font-black text-ink">连续扫描条码</Text>
                      <Text className="mt-1 text-[11px] leading-4 text-copy-muted">逐件扫描后统一确认数量、单位和到期日</Text>
                    </View>
                    <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setEntryMode("manual")}
                    className="mt-4 flex-row items-center rounded-[24px] border border-line bg-surface p-4 active:opacity-80"
                  >
                    <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
                      <FontAwesome6 name="pen" size={15} colorClassName="accent-brand" />
                    </View>
                    <View className="ml-4 flex-1">
                      <Text className="text-[15px] font-black text-ink">手动录入</Text>
                      <Text className="mt-1 text-[11px] leading-4 text-copy-muted">信息少、想精确填写时更合适</Text>
                    </View>
                    <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>

                  {!activeHousehold ? <InventoryTextIntake saveIntake={input => inventoryMutations.bulkIntake.mutateAsync(input)} onSaved={() => setModalVisible(false)} /> : null}

                  <TouchableOpacity
                    onPress={() => { setModalVisible(false); handleScanReceiptAndBatchAdd(); }}
                    className="mt-5 flex-row items-center justify-center gap-2 py-3"
                  >
                    <FontAwesome6 name="receipt" size={13} colorClassName="accent-brand" />
                    <Text className="text-xs font-black text-brand">扫描小票，批量导入多种食材</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : !editingItem && !activeHousehold ? (
              <ManualInventoryEntry saveIntake={input => inventoryMutations.bulkIntake.mutateAsync(input)} onSaved={() => setModalVisible(false)} onPhoto={source => void selectFoodPhoto(source)} photoUrl={imageUrl} bottomInset={insets.bottom} />
            ) : (
              <InventoryEntryForm
                evidencePanel={modalVisible && editingItem && !activeHousehold && user?.id && token ? <SavedInventoryEvidence key={`${user.id}:${editingItem.id}:${token}`} itemId={editingItem.id} version={editingItem.version} accountScope={`${user.id}:${token}`} authFetch={authFetch} /> : undefined}
                editingItem={editingItem}
                foodName={foodName}
                category={category}
                categoryMenuOpen={categoryMenuOpen}
                quantity={quantity}
                storageLocation={storageLocation}
                expirationDate={expirationDate}
                imageUrl={imageUrl}
                suggestions={suggestions}
                saving={saving}
                bottomInset={insets.bottom}
                onFoodNameChange={handleFoodNameChange}
                onApplySuggestion={applyIngredientDefaults}
                onToggleCategoryMenu={() => setCategoryMenuOpen((open) => !open)}
                onCategoryChange={(value) => {
                  setCategory(value);
                  setCategoryMenuOpen(false);
                }}
                onQuantityChange={setQuantity}
                onStorageLocationChange={handleStorageLocationChange}
                onExpirationDateChange={setExpirationDate}
                onSelectPhoto={(source) => void selectFoodPhoto(source)}
                onRemovePhoto={() => setImageUrl("")}
                onRequestAiRecipe={(item) => {
                  setModalVisible(false);
                  router.push({
                    pathname: "/ai-assistant",
                    params: {
                      prefill_food: item.food_name,
                      prompt: `我冰箱里有【${item.food_name}】(${item.quantity})，请帮我生成一份优先消耗它的营养餐单！`,
                    },
                  });
                }}
                onDelete={handleDeleteItem}
                onSave={() => void handleSaveItem()}
              />
            )}
          </KeyboardAvoidingView>
        </Modal>

        <BatchReviewModal
          visible={batchReviewVisible}
          foods={detectedFoods}
          saving={savingDetectedFoods}
          locked={Boolean(review.value.pending)}
          error={review.error || (review.value.pending ? "上次入库结果尚未确认，重试将沿用原始请求；确认前不能修改项目。" : "")}
          onClose={() => setBatchReviewVisible(false)}
          onChange={setDetectedFoods}
          onSave={saveDetectedFoods}
          onAddItem={handleAddPresetToBatch}
          onMergeDuplicates={() => setDetectedFoods((current) => mergeDetectedFoods(current))}
        />

        <Modal visible={barcodeScannerVisible} animationType="slide" onRequestClose={() => setBarcodeScannerVisible(false)}>
          <Screen safeAreaEdges={["top", "bottom"]}>
            <View className="flex-1 bg-ink">
              <View className="flex-row items-center justify-between px-4 py-3">
                <TouchableOpacity onPress={() => setBarcodeScannerVisible(false)} className="h-10 w-10 items-center justify-center rounded-full bg-white/15">
                  <FontAwesome6 name="xmark" size={14} colorClassName="accent-on-brand" />
                </TouchableOpacity>
                <Text className="text-base font-black text-white">连续扫描商品条码</Text>
                <View className="h-10 min-w-10 items-center justify-center rounded-full bg-brand-fill px-3"><Text className="text-xs font-black text-white">{detectedFoods.length}</Text></View>
              </View>
              {Platform.OS !== "web" && cameraPermission?.granted ? (
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
                  onBarcodeScanned={handleBarcodeScanned}
                />
              ) : (
                <View className="flex-1 items-center justify-center px-8">
                  <FontAwesome6 name="barcode" size={40} colorClassName="accent-on-brand" />
                  <Text className="mt-4 text-center text-sm leading-6 text-white/80">相机不可用或权限未开启，可在下方手动输入条码继续。</Text>
                </View>
              )}
              <View className="bg-surface px-5 pb-6 pt-4">
                <View className="flex-row items-center rounded-2xl border border-line bg-background-secondary px-3">
                  <TextInput
                    value={barcodeInput}
                    onChangeText={setBarcodeInput}
                    placeholder="手动输入 8–14 位条码"
                    placeholderTextColorClassName="accent-copy-muted"
                    keyboardType="number-pad"
                    onSubmitEditing={() => void lookupBarcode(barcodeInput)}
                    className="h-12 flex-1 text-sm text-ink"
                  />
                  <TouchableOpacity onPress={() => void lookupBarcode(barcodeInput)} disabled={barcodeLookingUp} className="rounded-xl bg-brand-fill px-4 py-2 disabled:opacity-50">
                    {barcodeLookingUp ? <ActivityIndicator size="small" colorClassName="accent-on-brand" /> : <Text className="text-xs font-black text-white">添加</Text>}
                  </TouchableOpacity>
                </View>
                <Text className="mt-2 text-[10px] text-copy-muted">已识别 {detectedFoods.length} 项；重复条码会自动忽略。</Text>
                <TouchableOpacity
                  onPress={() => {
                    setBarcodeScannerVisible(false);
                    if (detectedFoods.length) setBatchReviewVisible(true);
                  }}
                  disabled={!detectedFoods.length}
                  className="mt-4 items-center rounded-2xl bg-brand-fill py-4 disabled:opacity-40"
                >
                  <Text className="text-sm font-black text-white">完成扫描并逐项确认</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Screen>
        </Modal>

        <ExpiredCleanupModal
          visible={expiredCleanupVisible}
          items={expiredItemsForCleanup}
          clearing={clearingExpired}
          result={expiredCleanupResult}
          onClose={() => {
            if (clearingExpired) return;
            setExpiredCleanupVisible(false);
            setExpiredCleanupResult(null);
          }}
          onConfirm={() => void confirmBatchClearExpired()}
          onRetry={() => {
            setExpiredCleanupResult(null);
            void confirmBatchClearExpired();
          }}
        />

        <CatalogDetailModal
          item={selectedCatalogKitchenware}
          saving={savingKitchenware}
          owned={Boolean(selectedCatalogKitchenware && kitchenware.some((item) => item.name === selectedCatalogKitchenware.name))}
          onClose={() => setSelectedCatalogKitchenware(null)}
          onAdd={addCatalogKitchenware}
        />

        {/* Kitchenware Add Modal */}
        <Modal visible={kitchenwareModalVisible} animationType="slide" transparent onRequestClose={() => setKitchenwareModalVisible(false)}>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-surface rounded-t-[32px] p-6 max-h-[85%]">
              <View className="flex-row items-center justify-between mb-4 border-b border-background-secondary pb-3">
                <Text className="text-lg font-black text-ink">
                  {editingKitchenware ? "编辑厨具" : "录入我的新厨具/家电"}
                </Text>
                <TouchableOpacity onPress={() => setKitchenwareModalVisible(false)}>
                  <FontAwesome6 name="xmark" size={18} colorClassName="accent-copy-muted" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">厨具名称</Text>
                  <TextInput
                    value={kwName}
                    onChangeText={setKwName}
                    placeholder="搜索或输入厨具名称，如空气炸锅"
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                  {!editingKitchenware && (
                    <View className="mt-2">
                      <Text className="text-[11px] font-bold text-copy-muted mb-1.5">常用厨具类型</Text>
                      <View><ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View className="flex-row gap-2 pr-4">
                          {kitchenwareCatalog.filter((item) => !kwName.trim() || item.name.includes(kwName.trim())).slice(0, 8).map((item) => (
                            <TouchableOpacity key={item.id} onPress={() => setSelectedCatalogKitchenware(item)} className="bg-brand/10 border border-brand/15 px-3 py-2 rounded-xl">
                              <Text className="text-xs font-bold text-brand">{item.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView></View>
                    </View>
                  )}
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">厨具类型</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        {["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].map((cat) => (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => setKwCategory(cat)}
                            className={`items-center rounded-xl border px-3 py-2.5 ${
                              kwCategory === cat
                                ? "bg-brand-fill border-brand"
                                : "bg-canvas border-line"
                            }`}
                          >
                            <Text
                              className={`text-xs ${
                                kwCategory === cat ? "text-white font-bold" : "text-copy-muted"
                              }`}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">当前状态</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        {["常用", "良好", "需保养", "维修中", "闲置"].map((status) => (
                          <TouchableOpacity
                            key={status}
                            onPress={() => setKwStatus(status)}
                            className={`rounded-xl border px-3 py-2 ${
                              kwStatus === status
                                ? "border-brand bg-brand-fill"
                                : "border-line bg-canvas"
                            }`}
                          >
                            <Text className={`text-xs font-bold ${kwStatus === status ? "text-white" : "text-copy-muted"}`}>
                              {status}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>

                {kitchenwareAttributesForm.fields}

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">规格 / 备注</Text>
                  <TextInput
                    value={kwNote}
                    onChangeText={setKwNote}
                    placeholder="如: 32L 大容量 双温双控"
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">购买日期（可选）</Text>
                  <SmartDateInput accessibilityLabel="购买日期（可选）" value={kwPurchaseDate} onChange={setKwPurchaseDate} />
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">图片 URL（可选）</Text>
                  <TextInput
                    value={kwImageUrl}
                    onChangeText={setKwImageUrl}
                    placeholder="https://..."
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSaveKitchenware}
                  disabled={savingKitchenware}
                  className="bg-brand-fill py-4 rounded-2xl items-center mt-4 shadow-sm active:opacity-90"
                >
                  {savingKitchenware ? (
                    <ActivityIndicator colorClassName="accent-on-brand" />
                  ) : (
                    <Text className="text-base font-bold text-white">
                      {editingKitchenware ? "保存修改" : "确认入库装备"}
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
        <InventoryHistoryModal
          visible={historyModalVisible}
          logs={historyLogs}
          onClose={() => setHistoryModalVisible(false)}
          onClear={handleClearHistory}
        />
        <FamilyShareModal
          visible={familyModalVisible}
          activeHousehold={activeHousehold}
          households={households}
          onClose={() => setFamilyModalVisible(false)}
          onSelectHousehold={(h) => setActiveHousehold(h)}
          onRefreshHouseholds={refreshHouseholds}
        />
      </ScrollView>
    </Screen>
  );
}
