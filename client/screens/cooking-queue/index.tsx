import { ingredientConsumptionRequests, inventoryPreviewWarnings } from "@/utils/inventoryConsumptions";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { RecipeCover } from "@/components/RecipeCover";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import {
  cookingQueueApi,
  inventoryApi,
  shoppingListApi,
  type CookingQueueItem as ServerCookingQueueItem,
  type CookingQueueMealType,
  type InventoryItem,
} from "@/services/api";
import {
  getCookingQueue,
  mergeCookingQueueRuntime,
  markCookingQueueServerMigrated,
  needsCookingQueueServerMigration,
  saveCookingQueue,
  type CookingQueueItem as LocalCookingQueueItem,
} from "@/utils/cookingQueue";
import {
  cancelCookingReminder,
  formatCookingReminderTime,
  getCookingReminderPresets,
  replaceCookingReminder,
} from "@/utils/cookingReminders";
import { inferCategoryByName, inferIngredientDefaults } from "@/utils/ingredientRules";
import { ingredientNamesMatch, normalizeIngredientName } from "@/utils/ingredients";
import { normalizeShoppingItems } from "@/utils/shoppingList";

type CookingQueueItem = ServerCookingQueueItem & {
  reminderAt?: number;
  reminderNotificationId?: string;
};

const MEAL_TYPES: Array<{ value: CookingQueueMealType; label: string }> = [
  { value: "breakfast", label: "早餐" },
  { value: "lunch", label: "午餐" },
  { value: "dinner", label: "晚餐" },
  { value: "snack", label: "加餐" },
];

const STATUS_LABELS: Record<CookingQueueItem["status"], string> = {
  waiting: "待安排",
  preparing: "备料中",
  ready: "可开火",
  cooking: "烹饪中",
  completed: "已完成",
  cancelled: "已取消",
};

function localShadow(item: CookingQueueItem): LocalCookingQueueItem {
  return {
    queueItemId: item.id,
    recipeId: item.recipeId,
    title: item.title,
    imageUrl: item.imageUrl,
    cookTime: item.cookTime,
    calories: item.calories,
    difficulty: item.difficulty,
    addedAt: Date.parse(item.createdAt) || Date.now(),
    ingredients: item.ingredients.map(({ name, amount }) => ({ name, amount })),
    reminderAt: item.reminderAt,
    reminderNotificationId: item.reminderNotificationId,
    shoppingListSyncedAt: item.shoppingListSyncedAt ? Date.parse(item.shoppingListSyncedAt) : undefined,
    preparedIngredientNames: item.preparedIngredientNames,
  };
}

function getMissingIngredients(item: CookingQueueItem, inventory: InventoryItem[]) {
  return item.ingredients.filter((ingredient) => !inventory.some((stock) => (
    stock.is_available && ingredientNamesMatch(ingredient.name, stock.food_name)
  )));
}

export default function CookingQueueScreen() {
  const router = useSafeRouter();
  const { highlightRecipeId, highlightQueueItemId } = useSafeSearchParams<{ highlightRecipeId?: number; highlightQueueItemId?: string }>();
  const { user, sessionGeneration, isSessionCurrent } = useAuth();
  const authFetch = useAuthFetch();
  const userId = user?.id;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const starting = useRef(false);
  const stockConfirmation = useRef<((confirmed: boolean) => void) | null>(null);
  const [stockWarning, setStockWarning] = useState("");
  const answerStockCheck = (confirmed: boolean) => {
    stockConfirmation.current?.(confirmed); stockConfirmation.current = null; setStockWarning("");
  };
  const [items, setItems] = useState<CookingQueueItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shoppingSavingId, setShoppingSavingId] = useState<number | null>(null);
  const [reminderItem, setReminderItem] = useState<CookingQueueItem | null>(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [expandedQueueIds, setExpandedQueueIds] = useState<Set<string>>(() => new Set());
  const dueAlertedQueueIds = useRef(new Set<string>());
  const initializedExpansion = useRef(false);
  useEffect(() => {
    setStockWarning(""); setReminderItem(null); setItems([]); setInventory([]);
    setExpandedQueueIds(new Set()); initializedExpansion.current = false; dueAlertedQueueIds.current.clear();
    return () => { stockConfirmation.current?.(false); stockConfirmation.current = null; };
  }, [sessionGeneration]);

  const loadQueue = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setInventory([]);
      setLoading(false);
      return;
    }
    const current = () => mounted.current && isSessionCurrent(userId, sessionGeneration);
    setLoading(true);
    try {
      const [localItems, inventoryItems] = await Promise.all([
        getCookingQueue(userId),
        inventoryApi.list(authFetch).catch(() => []),
      ]);
      if (!current()) return;
      if (await needsCookingQueueServerMigration(userId)) {
        for (const item of localItems) {
          if (!current()) return;
          if (item.queueItemId) continue;
          await cookingQueueApi.add(authFetch, {
            recipeId: item.recipeId,
            idempotencyKey: `legacy-queue-${userId}-${item.recipeId}`,
            plannedAt: item.reminderAt ? new Date(item.reminderAt).toISOString() : null,
          });
        }
        if (!current()) return;
        await markCookingQueueServerMigrated(userId);
      }
      const serverItems = await cookingQueueApi.list(authFetch);
      if (!current()) return;
      const hydratedItems = mergeCookingQueueRuntime(serverItems, localItems);
      const retainedReminders = new Set(hydratedItems.map(item => item.reminderNotificationId).filter(Boolean));
      await Promise.all(localItems.filter(item => item.reminderNotificationId && !retainedReminders.has(item.reminderNotificationId)).map(item => cancelCookingReminder(item.reminderNotificationId)));
      if (!current()) return;
      await saveCookingQueue(userId, hydratedItems.map(localShadow));
      if (!current()) return;
      setItems(hydratedItems);
      setInventory(inventoryItems);
      if (!initializedExpansion.current && hydratedItems.length) {
        initializedExpansion.current = true;
        setExpandedQueueIds(new Set([(hydratedItems.find(item => item.id === highlightQueueItemId) ?? hydratedItems.find(item => item.recipeId === Number(highlightRecipeId)) ?? hydratedItems[0]).id]));
      }
    } catch (error) {
      if (!current()) return;
      Alert.alert("队列同步失败", error instanceof Error ? error.message : "请检查网络后重试");
    } finally {
      if (current()) setLoading(false);
    }
  }, [authFetch, highlightRecipeId, highlightQueueItemId, userId, sessionGeneration, isSessionCurrent]);

  useFocusEffect(useCallback(() => { void loadQueue(); }, [loadQueue]));

  const removeItem = async (item: CookingQueueItem) => {
    if (!userId) return;
    try {
      await cookingQueueApi.remove(authFetch, item.id);
      await cancelCookingReminder(item.reminderNotificationId);
      const next = items.filter((candidate) => candidate.id !== item.id);
      setItems(next);
      await saveCookingQueue(userId, next.map(localShadow));
    } catch (error) {
      Alert.alert("移除失败", error instanceof Error ? error.message : "请刷新后重试");
    }
  };

  const moveItem = async (item: CookingQueueItem, offset: -1 | 1) => {
    if (!userId) return;
    const currentIndex = items.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) return;
    const reordered = [...items];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    try {
      const updated = mergeCookingQueueRuntime(
        await cookingQueueApi.reorder(authFetch, reordered.map(({ id, version }) => ({ id, version }))),
        reordered.map(localShadow),
      );
      setItems(updated);
      await saveCookingQueue(userId, updated.map(localShadow));
    } catch (error) {
      Alert.alert("顺序已变化", error instanceof Error ? error.message : "正在重新同步队列");
      await loadQueue();
    }
  };

  const updateItem = async (
    item: CookingQueueItem,
    updates: Parameters<typeof cookingQueueApi.update>[2],
    localUpdates: Partial<Pick<CookingQueueItem, "reminderAt" | "reminderNotificationId">> = {},
  ) => {
    if (!userId || !mounted.current || !isSessionCurrent(userId, sessionGeneration)) return null;
    try {
      const updated = await cookingQueueApi.update(authFetch, item.id, { ...updates, version: item.version });
      if (!mounted.current || !isSessionCurrent(userId, sessionGeneration)) return null;
      const merged: CookingQueueItem = {
        ...updated,
        reminderAt: updated.plannedAt ? Date.parse(updated.plannedAt) : undefined,
        reminderNotificationId: item.reminderNotificationId,
        ...localUpdates,
      };
      const next = items.map((candidate) => candidate.id === item.id ? merged : candidate);
      setItems(next);
      await saveCookingQueue(userId, next.map(localShadow));
      return merged;
    } catch (error) {
      if (!mounted.current || !isSessionCurrent(userId, sessionGeneration)) return null;
      Alert.alert("队列已变化", error instanceof Error ? error.message : "正在重新同步队列");
      await loadQueue();
      return null;
    }
  };

  const toggleIngredientPrepared = async (item: CookingQueueItem, ingredientName: string) => {
    if (!userId) return;
    const normalizedTarget = normalizeIngredientName(ingredientName);
    const alreadyPrepared = item.preparedIngredientNames.some((name) => (
      normalizeIngredientName(name) === normalizedTarget
    ));
    const preparedIngredientNames = alreadyPrepared
      ? item.preparedIngredientNames.filter((name) => normalizeIngredientName(name) !== normalizedTarget)
      : [...item.preparedIngredientNames, ingredientName];
    const status = preparedIngredientNames.length === item.ingredients.length && item.ingredients.length
      ? "ready"
      : preparedIngredientNames.length ? "preparing" : "waiting";
    await updateItem(item, { version: item.version, preparedIngredientNames, status });
  };

  const toggleExpanded = (queueItemId: string) => {
    setExpandedQueueIds((current) => {
      const next = new Set(current);
      if (next.has(queueItemId)) next.delete(queueItemId);
      else next.add(queueItemId);
      return next;
    });
  };

  const startCooking = async (item: CookingQueueItem) => {
    if (!userId || starting.current) return;
    const current = () => mounted.current && isSessionCurrent(userId, sessionGeneration);
    starting.current = true;
    try {
      if (item.status !== "cooking") {
        const { requests, unknown } = ingredientConsumptionRequests(item.ingredients);
        const preview = requests.length ? await inventoryApi.consumptionPreview(authFetch, requests) : { items: [] };
        if (!current()) return;
        const warnings = inventoryPreviewWarnings(preview, unknown);
        if (!item.ingredients.length) warnings.push("菜谱未提供配料用量，请核对实际原料");
        if (warnings.length) {
          const message = `${warnings.join("\n")}\n\n请核对实际备料；如已另外备齐，可继续制作。当前检查不会扣库存，完成时仍按最新批次核对实际扣减。`;
          const confirmed = await new Promise<boolean>(resolve => { stockConfirmation.current = resolve; setStockWarning(message); });
          if (!confirmed) return;
        }
      }
      if (!current()) return;
      const started = await cookingQueueApi.start(authFetch, item.id, item.version);
      if (!current()) return;
      await cancelCookingReminder(item.reminderNotificationId);
      if (!current()) return;
      const next = items.map((candidate) => candidate.id === item.id
        ? { ...started, reminderAt: undefined, reminderNotificationId: undefined }
        : candidate);
      setItems(next);
      await saveCookingQueue(userId, next.map(localShadow));
      if (!current()) return;
      router.push("/cooking-mode", {
        recipeId: item.recipeId,
        fromQueue: true,
        queueItemId: started.id,
        queueVersion: started.version,
      });
    } catch (error) {
      if (!current()) return;
      Alert.alert("无法开始烹饪", error instanceof Error ? error.message : "请刷新队列后重试");
      await loadQueue();
    } finally { starting.current = false; }
  };

  useEffect(() => {
    if (starting.current) return;
    const dueItem = items.find(item => item.reminderAt && item.reminderAt <= Date.now() && !dueAlertedQueueIds.current.has(`${item.id}:${item.plannedAt}`));
    if (!dueItem) return;
    dueAlertedQueueIds.current.add(`${dueItem.id}:${dueItem.plannedAt}`);
    Alert.alert("烹饪提醒", `计划烹饪【${dueItem.title}】的时间到了，现在开始准备吗？`, [
      { text: "稍后", style: "cancel" },
      { text: "开始烹饪", onPress: () => void startCooking(dueItem) },
    ]);
  }, [items]); // startCooking intentionally uses the latest item version from this render.

  const addMissingToShoppingList = async (item: CookingQueueItem) => {
    if (!userId || shoppingSavingId) return;
    const missing = getMissingIngredients(item, inventory);
    if (!missing.length) return;
    setShoppingSavingId(item.recipeId);
    try {
      const existing = normalizeShoppingItems(await shoppingListApi.list<unknown[]>(authFetch));
      const additions = missing.filter((ingredient) => !existing.some((shoppingItem) => (
        !shoppingItem.checked && ingredientNamesMatch(ingredient.name, shoppingItem.name)
      )));
      await Promise.all(additions.map((ingredient) => {
        const defaults = inferIngredientDefaults(ingredient.name);
        return shoppingListApi.create(authFetch, {
          clientId: `queue:${item.recipeId}:${normalizeIngredientName(ingredient.name)}`,
          name: ingredient.name,
          amount: ingredient.amount || "适量",
          category: inferCategoryByName(ingredient.name),
          checked: false,
          storageLocation: defaults.storageLocation,
        });
      }));
      await updateItem(item, { version: item.version, shoppingListSyncedAt: new Date().toISOString() });
      Alert.alert(
        additions.length ? "已补入采购清单" : "采购清单已有这些食材",
        additions.length ? `已添加 ${additions.length} 种缺少食材。` : "没有重复添加，可直接查看采购清单。",
        [
          { text: "查看清单", onPress: () => router.push("/shopping-list") },
          { text: "好的", style: "cancel" },
        ],
      );
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : "采购清单暂时无法更新，请稍后重试。");
    } finally {
      setShoppingSavingId(null);
    }
  };

  const saveReminder = async (item: CookingQueueItem, date: Date) => {
    if (!userId || reminderSaving) return;
    setReminderSaving(true);
    try {
      const scheduled = await replaceCookingReminder({
        queueItemId: item.id, recipeId: item.recipeId, recipeTitle: item.title, userId, date,
      }, item.reminderNotificationId, async next => {
        if (!mounted.current || !isSessionCurrent(userId, sessionGeneration)) return false;
        return Boolean(await updateItem(item,
          { version: item.version, plannedAt: date.toISOString(), mealType: item.mealType },
          { reminderAt: date.getTime(), reminderNotificationId: next.notificationId }));
      });
      if (!scheduled || !mounted.current || !isSessionCurrent(userId, sessionGeneration)) return;
      setReminderItem(null);
      Alert.alert(
        "提醒已设置",
        scheduled.delivery === "device"
          ? `将在${formatCookingReminderTime(date)}提醒你开始烹饪。`
          : `已保存${formatCookingReminderTime(date)}的站内提醒；Web 端需打开应用后提示。`,
      );
    } catch (error) {
      if (!mounted.current || !isSessionCurrent(userId, sessionGeneration)) return;
      Alert.alert("提醒设置失败", error instanceof Error ? error.message : "请检查系统通知权限后重试。");
    } finally {
      setReminderSaving(false);
    }
  };

  const clearReminder = async (item: CookingQueueItem) => {
    if (!userId) return;
    const updated = await updateItem(
      item,
      { version: item.version, plannedAt: null },
      { reminderAt: undefined, reminderNotificationId: undefined },
    );
    if (!updated) return;
    await cancelCookingReminder(item.reminderNotificationId);
    setReminderItem(null);
  };

  const confirmClear = () => {
    if (!userId || !items.length) return;
    Alert.alert("清空烹饪队列", "确定移除队列中的全部菜谱和烹饪提醒吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "清空",
        style: "destructive",
        onPress: () => void Promise.all(items.map((item) => cancelCookingReminder(item.reminderNotificationId)))
          .then(() => cookingQueueApi.clear(authFetch))
          .then(() => saveCookingQueue(userId, []))
          .then(() => setItems([]))
          .catch((error) => Alert.alert("清空失败", error instanceof Error ? error.message : "请稍后重试")),
      },
    ]);
  };

  const readyCount = items.filter((item) => item.ingredients.length > 0 && getMissingIngredients(item, inventory).length === 0).length;
  const reminderCount = items.filter((item) => item.reminderAt && item.reminderAt > Date.now()).length;
  const totalCookTime = items.every(item => item.cookTime != null) ? items.reduce((total, item) => total + item.cookTime!, 0) : null;

  return (
    <Screen safeAreaEdges={["top", "bottom"]}>
      <View className="flex-row items-center border-b border-line bg-surface px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="返回" className="h-10 w-10 items-center justify-center rounded-full bg-background-secondary">
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>
        <View className="ml-3 flex-1">
          <Text className="text-lg font-black text-ink">烹饪队列</Text>
          <Text className="mt-0.5 text-[11px] text-copy-muted">备料、提醒、开火，在这里一次安排好</Text>
        </View>
        {items.length ? <TouchableOpacity onPress={confirmClear} className="px-2 py-2"><Text className="text-xs font-bold text-critical">清空</Text></TouchableOpacity> : null}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator colorClassName="accent-brand" /></View>
      ) : items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="h-16 w-16 items-center justify-center rounded-[24px] bg-brand-soft"><FontAwesome6 name="list-check" size={24} colorClassName="accent-brand" /></View>
          <Text className="mt-5 text-lg font-black text-ink">队列还是空的</Text>
          <Text className="mt-2 text-center text-sm leading-6 text-copy-muted">在菜谱详情页加入想做的菜，之后可统一补齐食材、设置提醒并开始烹饪。</Text>
          <TouchableOpacity onPress={() => router.replace("/")} className="mt-6 rounded-2xl bg-brand-fill px-6 py-3"><Text className="font-bold text-white">去找菜谱</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 44 }}>
          <View className="mb-4 w-full max-w-[760px] self-center flex-row rounded-[22px] bg-brand-fill p-4">
            <QueueSummary value={items.length} label="待烹饪" />
            <QueueSummary value={totalCookTime ?? "待核对"} label="菜谱分钟合计" />
            <QueueSummary value={readyCount} label="名称匹配" />
            <QueueSummary value={reminderCount} label="已设提醒" />
          </View>
          <View className="w-full max-w-[760px] self-center gap-3">
            {items.map((item, index) => {
              const missing = getMissingIngredients(item, inventory);
              const ingredientDataReady = item.ingredients.length > 0;
              const highlighted = highlightQueueItemId ? highlightQueueItemId === item.id : Number(highlightRecipeId) === item.recipeId;
              const reminderDue = Boolean(item.reminderAt && item.reminderAt <= Date.now());
              const expanded = expandedQueueIds.has(item.id);
              const preparedCount = item.ingredients.filter((ingredient) => item.preparedIngredientNames.some((name) => (
                normalizeIngredientName(name) === normalizeIngredientName(ingredient.name)
              ))).length;
              const preparedPercent = ingredientDataReady ? Math.round((preparedCount / item.ingredients.length) * 100) : 0;
              return (
                <View key={item.id} className={`overflow-hidden rounded-[22px] border bg-surface ${highlighted ? "border-warm" : "border-line"}`}>
                  <View className="flex-row">
                    <View className="relative h-32 w-32 shrink-0">
                      <RecipeCover uri={item.imageUrl} className="h-full w-full" placeholderClassName="h-full w-full" />
                      <View className="absolute left-2 top-2 h-7 min-w-7 items-center justify-center rounded-full bg-brand-fill px-2"><Text className="text-[10px] font-black text-white">{index + 1}</Text></View>
                    </View>
                    <View className="min-w-0 flex-1 p-3.5">
                      <View className="flex-row items-start">
                        <Text className="min-w-0 flex-1 text-base font-black text-ink" numberOfLines={2}>{item.title}</Text>
                        {items.length > 1 ? (
                          <View className="ml-2 flex-row gap-1">
                            <TouchableOpacity onPress={() => void moveItem(item, -1)} disabled={index === 0} accessibilityLabel={`将${item.title}上移`} className="h-7 w-7 items-center justify-center rounded-lg bg-background-secondary disabled:opacity-30">
                              <FontAwesome6 name="arrow-up" size={9} colorClassName="accent-copy-muted" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => void moveItem(item, 1)} disabled={index === items.length - 1} accessibilityLabel={`将${item.title}下移`} className="h-7 w-7 items-center justify-center rounded-lg bg-background-secondary disabled:opacity-30">
                              <FontAwesome6 name="arrow-down" size={9} colorClassName="accent-copy-muted" />
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                      <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
                        <Text className="text-[10px] font-black text-brand">{STATUS_LABELS[item.status]}</Text>
                        <Text className="text-[10px] font-bold text-copy-muted">{item.cookTime == null ? "烹饪时间未知" : `${item.cookTime} 分钟（菜谱参考）`}</Text>
                        {item.plannedDate && <Text className="text-[10px] font-bold text-copy-muted">目标餐 {item.plannedDate} · {item.plannedServings ?? "待核对"} 份</Text>}
                        {(item.productionMeals?.length ?? 0) > 1 && <Text className="text-[10px] font-bold text-copy-muted">{item.productionMeals?.length} 餐共用 · {item.plannedServings} 份</Text>}
                        <Text className="text-[10px] font-bold text-critical">{item.calories} kcal</Text>
                        <Text className={`text-[10px] font-black ${!ingredientDataReady || missing.length ? "text-critical" : "text-brand"}`}>
                          {!ingredientDataReady ? "食材待同步" : missing.length ? `缺 ${missing.length} 种食材` : "名称匹配，开火前核量"}
                        </Text>
                      </View>
                      {item.reminderAt ? (
                        <TouchableOpacity onPress={() => setReminderItem(item)} className={`mt-2 flex-row items-center ${reminderDue ? "opacity-100" : "opacity-80"}`}>
                          <FontAwesome6 name={reminderDue ? "bell" : "clock"} size={10} colorClassName={reminderDue ? "accent-critical" : "accent-copy-muted"} />
                          <Text className={`ml-1.5 text-[10px] font-bold ${reminderDue ? "text-critical" : "text-copy-muted"}`}>
                            {reminderDue ? "计划时间已到" : formatCookingReminderTime(item.reminderAt)}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      <Text className="mt-2 text-[9px] font-medium text-copy-muted">
                        完整制作时间还需核对准备、收尾、份量与设备安排
                      </Text>
                    </View>
                  </View>
                  <View className="border-t border-line px-3 py-3">
                    <View className="mb-3 flex-row flex-wrap items-center gap-1.5">
                      <Text className="mr-1 text-[10px] font-black text-copy-muted">安排到</Text>
                      {MEAL_TYPES.map((meal) => (
                        <TouchableOpacity
                          key={meal.value}
                          onPress={() => void updateItem(item, {
                            version: item.version,
                            mealType: item.mealType === meal.value ? null : meal.value,
                          })}
                          className={`rounded-full px-2.5 py-1.5 ${item.mealType === meal.value ? "bg-brand-fill" : "bg-background-secondary"}`}
                        >
                          <Text className={`text-[9px] font-black ${item.mealType === meal.value ? "text-white" : "text-copy-muted"}`}>{meal.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text className="text-[10px] font-black text-ink">备料进度</Text>
                        <Text className="mt-0.5 text-[9px] text-copy-muted">
                          {ingredientDataReady ? `${preparedCount}/${item.ingredients.length} 种已备好` : "正在同步食材明细"}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <View className={`rounded-full px-2 py-1 ${missing.length ? "bg-danger-soft" : "bg-brand-soft"}`}>
                          <Text className={`text-[9px] font-black ${missing.length ? "text-critical" : "text-brand"}`}>
                            {missing.length ? `采购 ${missing.length} 项` : "名称匹配"}
                          </Text>
                        </View>
                        <Text className="text-[10px] font-black text-brand">{preparedPercent}%</Text>
                      </View>
                    </View>
                    <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand/10">
                      <View className="h-full rounded-full bg-brand-fill" style={{ width: `${preparedPercent}%` }} />
                    </View>

                    <TouchableOpacity onPress={() => toggleExpanded(item.id)} className="mt-3 flex-row items-center justify-between rounded-xl bg-canvas px-3 py-2.5">
                      <View className="flex-row items-center">
                        <FontAwesome6 name="clipboard-check" size={11} colorClassName="accent-brand" />
                        <Text className="ml-2 text-[11px] font-black text-ink">备料清单与库存状态</Text>
                      </View>
                      <FontAwesome6 name={expanded ? "chevron-up" : "chevron-down"} size={9} colorClassName="accent-copy-muted" />
                    </TouchableOpacity>

                    {expanded ? (
                      <View className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
                        {ingredientDataReady ? item.ingredients.map((ingredient, ingredientIndex) => {
                          const prepared = item.preparedIngredientNames.some((name) => (
                            normalizeIngredientName(name) === normalizeIngredientName(ingredient.name)
                          ));
                          const inInventory = inventory.some((stock) => (
                            stock.is_available && ingredientNamesMatch(ingredient.name, stock.food_name)
                          ));
                          return (
                            <TouchableOpacity
                              key={`${ingredient.name}-${ingredientIndex}`}
                              onPress={() => void toggleIngredientPrepared(item, ingredient.name)}
                              className={`flex-row items-center px-3 py-3 ${ingredientIndex < item.ingredients.length - 1 ? "border-b border-line" : ""}`}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: prepared }}
                              accessibilityLabel={`${ingredient.name} ${ingredient.amount}`}
                            >
                              <View className={`h-5 w-5 items-center justify-center rounded-md border ${prepared ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}>
                                {prepared ? <FontAwesome6 name="check" size={9} colorClassName="accent-on-brand" /> : null}
                              </View>
                              <View className="ml-2.5 min-w-0 flex-1">
                                <Text className={`text-[11px] font-bold ${prepared ? "text-copy-muted line-through" : "text-ink"}`}>{ingredient.name}</Text>
                                <Text className="mt-0.5 text-[9px] text-copy-muted">{ingredient.amount}</Text>
                              </View>
                              <View className={`rounded-full px-2 py-1 ${inInventory ? "bg-brand-soft" : "bg-danger-soft"}`}>
                                <Text className={`text-[9px] font-black ${inInventory ? "text-brand" : "text-critical"}`}>
                                  {inInventory ? "库存已有" : "仍需采购"}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        }) : (
                          <View className="items-center px-4 py-5"><Text className="text-[10px] text-copy-muted">食材详情暂时无法读取，请稍后刷新。</Text></View>
                        )}
                      </View>
                    ) : null}

                    <View className="mt-3 flex-row gap-2">
                      {ingredientDataReady && missing.length ? (
                        <TouchableOpacity onPress={() => void addMissingToShoppingList(item)} disabled={shoppingSavingId === item.recipeId} className="h-10 flex-1 flex-row items-center justify-center rounded-xl bg-warm-soft disabled:opacity-60">
                          {shoppingSavingId === item.recipeId ? <ActivityIndicator size="small" colorClassName="accent-warm" /> : <FontAwesome6 name="basket-shopping" size={11} colorClassName="accent-warm" />}
                          <Text className="ml-1.5 text-[11px] font-black text-warm">{item.shoppingListSyncedAt ? "核对采购" : "补齐采购"}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity onPress={() => setReminderItem(item)} className="h-10 flex-1 flex-row items-center justify-center rounded-xl bg-brand-soft">
                        <FontAwesome6 name="bell" size={11} colorClassName="accent-brand" />
                        <Text className="ml-1.5 text-[11px] font-black text-brand">{item.reminderAt ? "调整提醒" : "提醒我"}</Text>
                      </TouchableOpacity>
                    </View>
                    <View className="mt-2 flex-row gap-2">
                      <TouchableOpacity onPress={() => router.push("/recipe-detail", { id: item.recipeId })} className="h-10 flex-1 flex-row items-center justify-center rounded-xl border border-line bg-surface">
                        <FontAwesome6 name="book-open" size={11} colorClassName="accent-copy-muted" />
                        <Text className="ml-1.5 text-[11px] font-black text-copy-muted">查看菜谱</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => void startCooking(item)} className="h-10 flex-[1.4] flex-row items-center justify-center rounded-xl bg-brand-fill">
                        <FontAwesome6 name="kitchen-set" size={11} colorClassName="accent-on-brand" />
                        <Text className="ml-1.5 text-[11px] font-black text-white">开始烹饪</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => void removeItem(item)} accessibilityLabel={`从队列移除${item.title}`} className="h-10 w-10 items-center justify-center rounded-xl bg-background-secondary">
                        <FontAwesome6 name="trash-can" size={11} colorClassName="accent-copy-muted" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      <Modal visible={Boolean(stockWarning)} animationType="fade" transparent onRequestClose={() => answerStockCheck(false)}>
        <View className="flex-1 items-center justify-center bg-black/45 px-5">
          <View className="max-h-[80%] w-full max-w-lg rounded-3xl bg-surface p-5">
            <Text accessibilityRole="header" className="text-lg font-black text-ink">开火前核对库存</Text>
            <ScrollView className="my-4 shrink"><Text className="text-sm leading-6 text-copy-muted">{stockWarning}</Text></ScrollView>
            <View className="flex-row gap-3">
              <TouchableOpacity accessibilityRole="button" onPress={() => answerStockCheck(false)} className="flex-1 items-center rounded-xl bg-background-secondary py-3"><Text className="font-bold text-copy-muted">暂不开火</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" onPress={() => answerStockCheck(true)} className="flex-1 items-center rounded-xl bg-brand-fill py-3"><Text className="font-bold text-white">已备齐，继续</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={Boolean(reminderItem)} animationType="fade" transparent onRequestClose={() => setReminderItem(null)}>
        <View className="flex-1 justify-end bg-black/45">
          <View className="rounded-t-[30px] bg-surface px-5 pb-8 pt-5">
            <View className="mb-4 flex-row items-center justify-between">
              <View className="flex-1 pr-4">
                <Text className="text-lg font-black text-ink">设置烹饪提醒</Text>
                <Text className="mt-1 text-xs text-copy-muted" numberOfLines={1}>{reminderItem?.title}</Text>
              </View>
              <TouchableOpacity onPress={() => setReminderItem(null)} className="h-9 w-9 items-center justify-center rounded-full bg-background-secondary"><FontAwesome6 name="xmark" size={14} colorClassName="accent-copy-muted" /></TouchableOpacity>
            </View>
            <View className="gap-2">
              {getCookingReminderPresets().map((preset) => (
                <TouchableOpacity key={preset.key} onPress={() => reminderItem && void saveReminder(reminderItem, preset.date)} disabled={reminderSaving} className="flex-row items-center rounded-2xl border border-line bg-surface px-4 py-3.5 disabled:opacity-60">
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-brand-soft"><FontAwesome6 name="clock" size={13} colorClassName="accent-brand" /></View>
                  <Text className="ml-3 flex-1 text-sm font-black text-ink">{preset.label}</Text>
                  <Text className="text-xs font-bold text-copy-muted">{preset.detail}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {reminderItem?.reminderAt ? (
              <TouchableOpacity onPress={() => void clearReminder(reminderItem)} disabled={reminderSaving} className="mt-3 items-center py-3"><Text className="text-xs font-bold text-critical">取消当前提醒</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function QueueSummary({ value, label }: { value: number | string; label: string }) {
  return (
    <View className="flex-1 items-center border-r border-white/15 last:border-r-0">
      <Text className="text-xl font-black text-white">{value}</Text>
      <Text className="mt-0.5 text-[10px] font-bold text-white/70">{label}</Text>
    </View>
  );
}
