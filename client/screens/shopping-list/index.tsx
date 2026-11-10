import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { getPrivateStorageGeneration, getUserStorageKey, SHOPPING_LIST_STORAGE_KEY, writeUserPrivateStorage } from "@/utils/userStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { householdApi, inventoryApi, shoppingListApi, type Household, type HouseholdShoppingItem } from "@/services/api";
import { ApiError } from "@/services/api/client";
import { dateKeyAfterDays, parseDateKey, toLocalDateKey } from "@/utils/date";
import { normalizeShoppingItems, type ShoppingItem } from "@/utils/shoppingList";
import { inferCategoryByName, inferIngredientDefaults, inferShelfLifeDays } from "@/utils/ingredientRules";
import { addInventoryLog } from "@/utils/inventoryHistory";

const CATEGORY_OPTIONS = [
  { label: "蔬菜", icon: "carrot", colorClass: "accent-success", bg: "bg-success-soft" },
  { label: "肉蛋", icon: "drumstick-bite", colorClass: "accent-critical", bg: "bg-danger-soft" },
  { label: "水果", icon: "apple-whole", colorClass: "accent-critical", bg: "bg-danger-soft" },
  { label: "调料", icon: "bottle-droplet", colorClass: "accent-warm", bg: "bg-warm-soft" },
  { label: "其他", icon: "cubes", colorClass: "accent-info", bg: "bg-info-soft" },
];

const GROUP_SECTION_CONFIG = [
  { key: "蔬菜", title: "蔬菜生鲜区", icon: "carrot", colorClass: "accent-success", bg: "bg-success-soft" },
  { key: "肉蛋", title: "肉蛋水产区", icon: "drumstick-bite", colorClass: "accent-critical", bg: "bg-danger-soft" },
  { key: "水果", title: "水果甜品区", icon: "apple-whole", colorClass: "accent-critical", bg: "bg-danger-soft" },
  { key: "调料", title: "调料粮油区", icon: "bottle-droplet", colorClass: "accent-warm", bg: "bg-warm-soft" },
  { key: "其他", title: "其他综合区", icon: "cubes", colorClass: "accent-info", bg: "bg-info-soft" },
];

type CollaborativeShoppingItem = ShoppingItem & {
  creatorName?: string;
  updaterName?: string;
  purchaserName?: string | null;
  expirationDate?: string;
};

function fromHouseholdItem(item: HouseholdShoppingItem): CollaborativeShoppingItem {
  return {
    id: item.id,
    name: item.name,
    amount: item.amount,
    category: item.category,
    checked: item.checked,
    createdAt: Date.parse(item.createdAt) || Date.now(),
    storageLocation: item.storageLocation || undefined,
    version: item.version,
    creatorName: item.creatorName,
    updaterName: item.updaterName,
    purchaserName: item.purchaserName,
    expirationDate: item.expirationDate || undefined,
  };
}

export default function ShoppingListScreen() {
  const { user, sessionGeneration } = useAuth();
  return <ShoppingListSession key={`${user?.id ?? "guest"}:${sessionGeneration}`} />;
}

function ShoppingListSession() {
  const [activeHousehold, setActiveHousehold] = useState<Household | null>(null);
  // Each selection owns its rows, forms and in-flight operations, including A → B → A.
  return <ShoppingListContent key={activeHousehold?.id ?? "personal"}
    activeHousehold={activeHousehold} setActiveHousehold={setActiveHousehold} />;
}

function ShoppingListContent({ activeHousehold, setActiveHousehold }: {
  activeHousehold: Household | null;
  setActiveHousehold: React.Dispatch<React.SetStateAction<Household | null>>;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const storageKey = getUserStorageKey(SHOPPING_LIST_STORAGE_KEY, user?.id);
  const generation = user?.id ? getPrivateStorageGeneration(user.id) : 0;
  const mounted = useRef(true);
  const latestLoad = useRef(0);
  const isCurrent = useCallback(() => mounted.current
    && (!user?.id || getPrivateStorageGeneration(user.id) === generation), [user?.id, generation]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; latestLoad.current += 1; };
  }, []);

  const [items, setItems] = useState<CollaborativeShoppingItem[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverReady, setServerReady] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("蔬菜");
  const [smartHint, setSmartHint] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"all" | "pending" | "done">("pending");
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [movingToInventory, setMovingToInventory] = useState(false);
  const importKeys = useRef(new Map<string, string>());
  const personalImportInFlight = useRef(false);

  // Edit Modal State
  const [editingItem, setEditingItem] = useState<CollaborativeShoppingItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("蔬菜");
  const [editPurchaseDate, setEditPurchaseDate] = useState("");

  // 加载数据
  const loadShoppingList = useCallback(async () => {
    if (!isCurrent()) return;
    const request = ++latestLoad.current;
    const currentLoad = () => isCurrent() && request === latestLoad.current;
    setServerReady(false);
    if (!storageKey) {
      setLoading(false);
      return;
    }
    try {
      const householdList = await householdApi.mine(authFetch);
      if (!currentLoad()) return;
      setHouseholds(householdList);
      if (activeHousehold) {
        const currentHousehold = householdList.find((household) => household.id === activeHousehold.id);
        if (!currentHousehold) {
          setActiveHousehold(null);
          return;
        } else {
          setActiveHousehold(currentHousehold);
          const familyItems = await householdApi.shoppingList(authFetch, currentHousehold.id);
          if (!currentLoad()) return;
          setItems(familyItems.map(fromHouseholdItem));
          setServerReady(true);
          return;
        }
      }
      const saved = await AsyncStorage.getItem(storageKey);
      if (!currentLoad()) return;
      const cachedItems = saved ? normalizeShoppingItems(JSON.parse(saved)) : [];
      setItems(cachedItems);
      const imported = await shoppingListApi.import<{ items: unknown[] }>(
        authFetch,
        `shopping-list-migration-v1:${user?.id || "anonymous"}`,
        cachedItems.map((item) => ({
          clientId: item.clientId || item.id,
          name: item.name,
          amount: item.amount,
          category: item.category,
          checked: item.checked,
          purchaseDate: item.purchaseDate,
          storageLocation: item.storageLocation,
        })),
      );
      if (!currentLoad()) return;
      const authoritative = normalizeShoppingItems(imported.items);
      setItems(authoritative);
      await writeUserPrivateStorage(SHOPPING_LIST_STORAGE_KEY, user!.id, generation, JSON.stringify(authoritative));
      if (currentLoad()) setServerReady(true);
    } catch (err) {
      if (!currentLoad()) return;
      console.error("Failed to load shopping list:", err);
      setServerReady(false);
    } finally {
      if (currentLoad()) setLoading(false);
    }
  }, [activeHousehold?.id, authFetch, generation, isCurrent, setActiveHousehold, storageKey, user?.id]);

  useEffect(() => {
    loadShoppingList();
  }, [loadShoppingList]);

  // 保存数据
  const cacheItems = async (newItems: CollaborativeShoppingItem[]) => {
    if (!isCurrent()) return false;
    setItems(newItems);
    if (user?.id && !activeHousehold) {
      await writeUserPrivateStorage(SHOPPING_LIST_STORAGE_KEY, user.id, generation, JSON.stringify(newItems));
    }
    return isCurrent();
  };

  // 输入食材名称时智能反应
  const handleNameInputChange = (text: string) => {
    setNameInput(text);
    if (!text.trim()) {
      setSmartHint(null);
      return;
    }
    const defaults = inferIngredientDefaults(text);
    let matchedOpt = CATEGORY_OPTIONS.find((c) => c.label === defaults.category);
    if (!matchedOpt) {
      if (defaults.category === "肉食") matchedOpt = CATEGORY_OPTIONS.find((c) => c.label === "肉蛋");
      else if (defaults.category === "粮油干货") matchedOpt = CATEGORY_OPTIONS.find((c) => c.label === "调料");
    }

    if (matchedOpt) {
      setSelectedCategory(matchedOpt.label);
      setSmartHint(`自动识别为 [${matchedOpt.label}] · 建议存放在 [${defaults.storageLocation}]`);
    } else {
      setSmartHint(null);
    }
  };

  // 添加新食材
  const handleAddItem = async () => {
    if (!nameInput.trim()) {
      Alert.alert("提示", "请输入食材名称");
      return;
    }
    if (!serverReady) {
      Alert.alert("当前为离线缓存", "采购清单以服务端为准，请恢复网络后再修改。");
      return;
    }
    try {
      const input = {
        name: nameInput.trim(),
        amount: amountInput.trim() || "适量",
        category: selectedCategory,
        storageLocation: inferIngredientDefaults(nameInput).storageLocation,
      };
      const familyResult = activeHousehold
        ? await householdApi.shoppingCreate(authFetch, activeHousehold.id, input)
        : null;
      const created = familyResult?.item || await shoppingListApi.create<unknown>(authFetch, {
        clientId: `manual:${Date.now()}`,
        ...input,
        checked: false,
      });
      const newItem = activeHousehold
        ? fromHouseholdItem(created as HouseholdShoppingItem)
        : normalizeShoppingItems([created])[0];
      if (!newItem) throw new Error("服务端返回了无效采购项");
      if (!await cacheItems([newItem, ...items])) return;
      setNameInput("");
      setAmountInput("");
      setSmartHint(null);
      if (familyResult?.mergeCandidates.length) {
        Alert.alert("发现同名项目", `清单中已有 ${familyResult.mergeCandidates.map((item) => `${item.name} ${item.amount}`).join("、")}。已保留为独立规格，请核对后手动合并。`);
      }
    } catch (error) {
      if (!isCurrent()) return;
      Alert.alert("添加失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 打开编辑弹窗
  const openEditModal = (item: CollaborativeShoppingItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditAmount(item.amount);
    setEditCategory(item.category || "蔬菜");
    setEditPurchaseDate(activeHousehold
      ? item.expirationDate || dateKeyAfterDays(inferShelfLifeDays(item.name, (item.storageLocation || inferIngredientDefaults(item.name).storageLocation) as any))
      : item.purchaseDate || toLocalDateKey(new Date()));
  };

  const handleSaveEditedItem = async () => {
    if (!editingItem) return;
    if (!editName.trim()) {
      Alert.alert("提示", "食材名称不能为空");
      return;
    }
    if (!serverReady || !editingItem.version) {
      Alert.alert("无法修改", "请联网刷新采购清单后重试。");
      return;
    }
    try {
      const input = {
        version: editingItem.version,
        name: editName.trim(),
        amount: editAmount.trim() || "适量",
        category: editCategory,
        storageLocation: inferIngredientDefaults(editName).storageLocation,
        ...(activeHousehold ? { expirationDate: editPurchaseDate.trim() } : {}),
      };
      const saved = activeHousehold
        ? await householdApi.shoppingUpdate(authFetch, activeHousehold.id, editingItem.id, input)
        : await shoppingListApi.update<unknown>(authFetch, editingItem.id, {
          ...input,
          purchaseDate: editPurchaseDate.trim() || toLocalDateKey(new Date()),
        });
      const updatedItem = activeHousehold
        ? fromHouseholdItem(saved as HouseholdShoppingItem)
        : normalizeShoppingItems([saved])[0];
      if (!updatedItem) throw new Error("服务端返回了无效采购项");
      if (!await cacheItems(items.map((item) => item.id === editingItem.id ? updatedItem : item))) return;
      setEditingItem(null);
    } catch (error) {
      if (!isCurrent()) return;
      Alert.alert("保存失败", error instanceof Error ? error.message : "请刷新后重试");
    }
  };

  // 勾选/取消勾选
  const handleToggleCheck = async (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!serverReady || !item?.version) return Alert.alert("当前为离线缓存", "联网后才能修改采购状态。");
    try {
      const saved = activeHousehold
        ? await householdApi.shoppingUpdate(authFetch, activeHousehold.id, id, { version: item.version, checked: !item.checked })
        : await shoppingListApi.update<unknown>(authFetch, id, { version: item.version, checked: !item.checked });
      const updatedItem = activeHousehold
        ? fromHouseholdItem(saved as HouseholdShoppingItem)
        : normalizeShoppingItems([saved])[0];
      if (!updatedItem) throw new Error("服务端返回了无效采购项");
      await cacheItems(items.map((candidate) => candidate.id === id ? updatedItem : candidate));
    } catch (error) {
      if (!isCurrent()) return;
      Alert.alert("更新失败", error instanceof Error ? error.message : "请刷新后重试");
    }
  };

  // 删除单项
  const handleDeleteItem = async (id: string) => {
    if (!serverReady) return Alert.alert("当前为离线缓存", "联网后才能删除采购项。");
    try {
      const item = items.find((candidate) => candidate.id === id);
      if (activeHousehold) {
        if (!item?.version) throw new Error("缺少采购项版本，请刷新后重试");
        await householdApi.shoppingRemove(authFetch, activeHousehold.id, id, item.version);
      } else {
        await shoppingListApi.remove(authFetch, id);
      }
      await cacheItems(items.filter((item) => item.id !== id));
    } catch (error) {
      if (!isCurrent()) return;
      Alert.alert("删除失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 清空已买项目
  const handleClearChecked = () => {
    if (!isCurrent() || !serverReady) return;
    const checkedCount = items.filter((i) => i.checked).length;
    if (checkedCount === 0) return;
    Alert.alert("确认清空", `确定要清除 ${checkedCount} 项已采购的项目吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "确认清除",
        style: "destructive",
        onPress: () => {
          void (async () => {
            if (!isCurrent()) return;
            try {
              await Promise.all(items.filter((item) => item.checked).map((item) => activeHousehold
                ? householdApi.shoppingRemove(authFetch, activeHousehold.id, item.id, item.version || 0)
                : shoppingListApi.remove(authFetch, item.id)));
              await cacheItems(items.filter((item) => !item.checked));
            } catch (error) {
              if (!isCurrent()) return;
              Alert.alert("清除失败", error instanceof Error ? error.message : "请稍后重试");
            }
          })();
        },
      },
    ]);
  };

  // 将已买食材一键存入冰箱库 (智能应用保质期与存储位置规则)
  const handleMoveCheckedToInventory = async () => {
    if (!isCurrent() || personalImportInFlight.current) return;
    if (!serverReady) {
      Alert.alert("当前为离线缓存", "请联网刷新采购清单后再入库。");
      return;
    }
    const checkedItems = items.filter((i) => i.checked);
    if (checkedItems.length === 0) {
      Alert.alert("提示", "请先勾选打钩已买到的食材。");
      return;
    }

    if (activeHousehold) {
      const confirmed = checkedItems.map((item) => {
        const location = item.storageLocation || inferIngredientDefaults(item.name).storageLocation;
        return {
          id: item.id,
          version: item.version || 0,
          quantity: item.amount,
          expirationDate: item.expirationDate || dateKeyAfterDays(inferShelfLifeDays(item.name, location as any)),
          storageLocation: location,
        };
      });
      const summary = confirmed.map((item, index) => `${checkedItems[index].name}：${item.quantity} · ${item.expirationDate} · ${item.storageLocation}`).join("\n");
      Alert.alert("确认转入家庭库存", `请核对数量、保质期和存放位置：\n\n${summary}`, [
        { text: "返回修改", style: "cancel" },
        {
          text: "确认入库",
          onPress: () => {
            void (async () => {
              if (!isCurrent()) return;
              setMovingToInventory(true);
              try {
                const signature = confirmed.map((item) => `${item.id}:${item.version}`).sort().join("|");
                const idempotencyKey = importKeys.current.get(signature) || `household-shopping-${activeHousehold.id}-${Date.now()}`;
                importKeys.current.set(signature, idempotencyKey);
                const result = await householdApi.shoppingIntake(authFetch, activeHousehold.id, { idempotencyKey, items: confirmed });
                if (!isCurrent()) return;
                importKeys.current.delete(signature);
                await loadShoppingList();
                if (!isCurrent()) return;
                Alert.alert("家庭入库成功", `已将 ${result.count} 项转入【${activeHousehold.name}】共享库存。`, [
                  { text: "继续采购" },
                  { text: "查看家庭库存", onPress: () => router.push("/inventory") },
                ]);
              } catch (error) {
                if (!isCurrent()) return;
                Alert.alert("入库未完成", error instanceof Error ? error.message : "请刷新家庭清单后重试");
                await loadShoppingList();
              } finally {
                if (isCurrent()) setMovingToInventory(false);
              }
            })();
          },
        },
      ]);
      return;
    }

    if (checkedItems.some((item) => !item.version)) {
      Alert.alert("无法入库", "请联网刷新采购清单后重试。");
      return;
    }
    personalImportInFlight.current = true;
    setMovingToInventory(true);
    try {
      const signature = checkedItems.map((item) => `${item.id}:${item.version}`).sort().join("|");
      const idempotencyKey =
        importKeys.current.get(signature) ||
        `shopping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      importKeys.current.set(signature, idempotencyKey);

      const itemsToImport = checkedItems.map((item) => {
        const defaults = inferIngredientDefaults(item.name);
        const location = (item.storageLocation || defaults.storageLocation) as "冷藏" | "冷冻" | "常温";
        const shelfDays = inferShelfLifeDays(item.name, location as any);
        const startDate = item.purchaseDate ? parseDateKey(item.purchaseDate) || new Date() : new Date();
        const expDate = dateKeyAfterDays(shelfDays, startDate);

        return {
          food_name: item.name,
          category: defaults.category,
          quantity: item.amount || defaults.defaultQuantity,
          storage_location: location,
          expiration_date: expDate,
          image_url: null,
        };
      });

      const result = await inventoryApi.importShoppingList(authFetch, idempotencyKey, itemsToImport,
        checkedItems.map((item) => ({ id: item.id, version: item.version! })));
      if (!isCurrent()) return;
      importKeys.current.delete(signature);

      // 记录到库存操作历史
      for (const item of result.repeated ? [] : itemsToImport) {
        if (!isCurrent()) return;
        await addInventoryLog(
          {
            foodName: item.food_name,
            action: "add",
            quantity: item.quantity,
            storageLocation: item.storage_location,
          },
          user?.id
        );
      }

      if (!isCurrent()) return;
      const importedIds = new Set(checkedItems.map((item) => item.id));
      setItems((current) => current.filter((item) => !importedIds.has(item.id)));
      // The server has already committed both changes. A cache failure must not
      // turn a successful intake into an invitation to submit it again.
      if (user?.id) {
        await writeUserPrivateStorage(SHOPPING_LIST_STORAGE_KEY, user.id, generation, JSON.stringify(items.filter((item) => !importedIds.has(item.id))))
          .catch((error) => console.error("Failed to cache shopping list after intake:", error));
      }

      if (!isCurrent()) return;
      Alert.alert(
        "入库成功！",
        `已将 ${checkedItems.length} 件食材智能算期录入【冰箱食材库】，采购清单已同步更新。`,
        [
          { text: "继续买菜", style: "cancel" },
          { text: "查看冰箱库", onPress: () => router.push("/inventory") },
        ]
      );
    } catch (err) {
      if (!isCurrent()) return;
      console.error("Failed to move items to inventory:", err);
      Alert.alert("入库未完成", err instanceof Error ? err.message : "存入冰箱库失败，请重试。");
      if (err instanceof ApiError && err.code === "SHOPPING_ITEM_CONFLICT") {
        await loadShoppingList();
      }
    } finally {
      personalImportInFlight.current = false;
      if (isCurrent()) setMovingToInventory(false);
    }
  };

  const pendingItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);
  const filteredItems = items.filter((i) => {
    if (activeTab === "pending") return !i.checked;
    if (activeTab === "done") return i.checked;
    return true;
  });

  const progressPercent = items.length > 0 ? Math.round((checkedItems.length / items.length) * 100) : 0;

  return (
    <Screen safeAreaEdges={["top", "bottom", "left", "right"]}>
      {/* 顶部 Header */}
      <View className="px-5 py-3.5 flex-row items-center justify-between border-b border-line bg-surface/80 shadow-xs">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2 active:opacity-70">
          <FontAwesome6 name="chevron-left" size={18} colorClassName="accent-ink" />
        </TouchableOpacity>

        <View className="flex-row items-center gap-2">
          <FontAwesome6 name="cart-shopping" size={16} colorClassName="accent-warm" />
          <Text className="text-base font-black text-ink">{activeHousehold ? `${activeHousehold.name}采购` : "智能采购清单"}</Text>
        </View>

        {checkedItems.length > 0 ? (
          <TouchableOpacity onPress={handleClearChecked} className="p-1 active:opacity-70">
            <Text className="text-xs font-bold text-critical">清空已买</Text>
          </TouchableOpacity>
        ) : (
          <View className="w-8" />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} className="flex-1 px-5 pt-4">
        <View className="mb-4">
          <Text className="mb-2 text-[10px] font-black text-copy-muted">清单归属</Text>
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <TouchableOpacity onPress={() => setActiveHousehold(null)} className={`flex-row items-center rounded-full border px-3.5 py-2 ${!activeHousehold ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}>
                <FontAwesome6 name="user" size={10} colorClassName={!activeHousehold ? "accent-on-brand" : "accent-copy-muted"} />
                <Text className={`ml-1.5 text-[11px] font-black ${!activeHousehold ? "text-white" : "text-copy-muted"}`}>个人清单</Text>
              </TouchableOpacity>
              {households.map((household) => (
                <TouchableOpacity key={household.id} onPress={() => setActiveHousehold(household)} className={`flex-row items-center rounded-full border px-3.5 py-2 ${activeHousehold?.id === household.id ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}>
                  <FontAwesome6 name="house-user" size={10} colorClassName={activeHousehold?.id === household.id ? "accent-on-brand" : "accent-copy-muted"} />
                  <Text className={`ml-1.5 text-[11px] font-black ${activeHousehold?.id === household.id ? "text-white" : "text-copy-muted"}`}>{household.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          {activeHousehold ? <Text className="mt-2 text-[10px] leading-4 text-copy-muted">家庭成员共享同一服务端清单；离线状态只读，恢复网络后按版本同步。</Text> : null}
        </View>

        {/* 采购进度概览 Banner */}
        <View className="bg-surface rounded-3xl p-4 border border-line shadow-xs mb-4">
          <View className="flex-row items-center justify-between mb-2">
            <View>
              <Text className="text-xs font-bold text-copy-muted">采购完成度</Text>
              <Text className="text-lg font-black text-ink">
                已购买 {checkedItems.length} / <Text className="text-success">{items.length}</Text> 项
              </Text>
            </View>
            <View className="bg-success-soft px-3 py-1.5 rounded-full border border-success/30">
              <Text className="text-xs font-black text-success">{progressPercent}% 进度</Text>
            </View>
          </View>
          {/* 进度条 */}
          <View className="w-full h-2.5 bg-canvas rounded-full overflow-hidden border border-line">
            <View className="h-full bg-success-fill rounded-full" style={{ width: `${progressPercent}%` }} />
          </View>
        </View>

        {/* 快捷录入输入框卡片 */}
        <View className="bg-surface p-4 rounded-3xl border border-line shadow-xs mb-4">
          <Text className="text-xs font-black text-ink mb-2">快速添加采购食材</Text>

          <View className="flex-row gap-2 mb-2">
            <TextInput
              value={nameInput}
              onChangeText={handleNameInputChange}
              placeholder="食材名称 (如: 鸡胸肉)"
              placeholderTextColorClassName="accent-copy-muted"
              className="flex-1 bg-canvas px-3.5 py-2.5 rounded-2xl border border-line text-xs text-ink font-medium"
            />
            <TextInput
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder="分量 (如: 500g)"
              placeholderTextColorClassName="accent-copy-muted"
              className="w-28 bg-canvas px-3.5 py-2.5 rounded-2xl border border-line text-xs text-ink font-medium"
            />
          </View>

          {/* 智能保质期推荐提示 */}
          {smartHint && (
            <View className="mb-2 px-2 py-1 rounded-xl bg-warm-soft border border-warm/30">
              <Text className="text-[10px] font-bold text-warm">{smartHint}</Text>
            </View>
          )}

          {/* 分类 Pills */}
          <View className="flex-row items-center justify-between mb-1">
            <View className="flex-row items-center gap-1.5 flex-wrap">
              {CATEGORY_OPTIONS.map((cat) => (
                <TouchableOpacity
                  key={cat.label}
                  onPress={() => setSelectedCategory(cat.label)}
                  className={`px-2.5 py-1 rounded-full border flex-row items-center gap-1 transition-all ${
                    selectedCategory === cat.label
                      ? "bg-brand-fill border-brand"
                      : "bg-canvas border-line"
                  }`}
                >
                  <FontAwesome6
                    name={cat.icon}
                    size={10}
                    colorClassName={selectedCategory === cat.label ? "accent-on-brand" : cat.colorClass}
                  />
                  <Text
                    className={`text-[11px] font-bold ${
                      selectedCategory === cat.label ? "text-white" : "text-ink"
                    }`}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleAddItem}
              className="bg-brand-fill px-4 py-2 rounded-2xl flex-row items-center gap-1 active:scale-95 shadow-xs"
            >
              <FontAwesome6 name="plus" size={12} colorClassName="accent-on-brand" />
              <Text className="text-xs font-black text-white">添加</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* AI Chef 缺料识别智能 Banner */}
        <TouchableOpacity
          onPress={() => router.push("/ai-assistant")}
          className="bg-success-soft border border-success/30 p-3.5 rounded-2xl flex-row items-center justify-between mb-4 shadow-xs active:opacity-80"
        >
          <View className="flex-row items-center gap-2.5 flex-1 pr-2">
            <View className="w-8 h-8 rounded-full bg-success-fill items-center justify-center">
              <FontAwesome6 name="wand-magic-sparkles" size={13} colorClassName="accent-on-brand" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-black text-success">AI 食语智能算料</Text>
              <Text className="text-[10px] text-success font-medium">菜谱缺失食材一键精准算料生成采购单</Text>
            </View>
          </View>
          <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-success" />
        </TouchableOpacity>

        {/* Filter Tabs & View Mode Switcher */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-1.5">
            <TouchableOpacity
              onPress={() => setActiveTab("pending")}
              className={`px-3 py-1.5 rounded-full border ${
                activeTab === "pending"
                  ? "bg-brand-fill border-brand"
                  : "bg-surface border-line"
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  activeTab === "pending" ? "text-white" : "text-copy-muted"
                }`}
              >
                待买 ({pendingItems.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab("done")}
              className={`px-3 py-1.5 rounded-full border ${
                activeTab === "done"
                  ? "bg-brand-fill border-brand"
                  : "bg-surface border-line"
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  activeTab === "done" ? "text-white" : "text-copy-muted"
                }`}
              >
                已买 ({checkedItems.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-full border ${
                activeTab === "all"
                  ? "bg-brand-fill border-brand"
                  : "bg-surface border-line"
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  activeTab === "all" ? "text-white" : "text-copy-muted"
                }`}
              >
                全部 ({items.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* 视图模式切换 */}
          <View className="flex-row items-center rounded-full bg-surface border border-line p-0.5">
            <TouchableOpacity
              onPress={() => setViewMode("grouped")}
              className={`px-2.5 py-1 rounded-full ${
                viewMode === "grouped" ? "bg-brand/10 border border-brand/30" : ""
              }`}
            >
              <Text className={`text-[10px] font-bold ${viewMode === "grouped" ? "text-brand" : "text-copy-muted"}`}>
                分组
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode("flat")}
              className={`px-2.5 py-1 rounded-full ${
                viewMode === "flat" ? "bg-brand/10 border border-brand/30" : ""
              }`}
            >
              <Text className={`text-[10px] font-bold ${viewMode === "flat" ? "text-brand" : "text-copy-muted"}`}>
                列表
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 清单列表 */}
        {loading ? (
          <ActivityIndicator size="small" colorClassName="accent-brand" className="my-8" />
        ) : filteredItems.length === 0 ? (
          <View className="items-center py-10 bg-surface/70 rounded-3xl border border-dashed border-line my-2">
            <FontAwesome6 name="basket-shopping" size={32} colorClassName="accent-warm" />
            <Text className="text-xs text-copy-muted mt-2.5 font-bold">
              {activeTab === "pending" ? "暂无待采购食材" : "清单空空如也"}
            </Text>
            <Text className="text-[10px] text-copy-muted mt-1">在上方输入或在 AI 聊天中一键计算生成</Text>
          </View>
        ) : viewMode === "grouped" ? (
          /* 按区域/品类分组视图 */
          <View className="gap-3">
            {GROUP_SECTION_CONFIG.map((section) => {
              const sectionItems = filteredItems.filter((i) => {
                if (section.key === "蔬菜") return i.category === "蔬菜";
                if (section.key === "肉蛋") return i.category === "肉蛋" || i.category === "肉食";
                if (section.key === "水果") return i.category === "水果";
                if (section.key === "调料") return i.category === "调料" || i.category === "粮油干货";
                return !["蔬菜", "肉蛋", "肉食", "水果", "调料", "粮油干货"].includes(i.category);
              });

              if (sectionItems.length === 0) return null;

              return (
                <View key={section.key} className="rounded-3xl border border-line bg-surface p-3.5 shadow-2xs">
                  <View className="flex-row items-center justify-between mb-2.5 px-1 border-b border-line/60 pb-2">
                    <View className="flex-row items-center gap-2">
                      <View className={`w-6 h-6 rounded-lg items-center justify-center ${section.bg}`}>
                        <FontAwesome6 name={section.icon} size={11} colorClassName={section.colorClass} />
                      </View>
                      <Text className="text-xs font-black text-ink">{section.title}</Text>
                    </View>
                    <Text className="text-[10px] font-bold text-copy-muted">{sectionItems.length} 项</Text>
                  </View>

                  <View className="gap-2">
                    {sectionItems.map((item) => renderShoppingItemCard(item))}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          /* 平铺列表视图 */
          <View className="gap-2">
            {filteredItems.map((item) => renderShoppingItemCard(item))}
          </View>
        )}

        {/* 🧊 将已买食材一键存入【冰箱库】Action */}
        {checkedItems.length > 0 && (
          <TouchableOpacity
            onPress={handleMoveCheckedToInventory}
            disabled={movingToInventory}
            className="mt-5 bg-brand-fill p-4 rounded-2xl flex-row items-center justify-center gap-2 shadow-sm active:scale-95"
          >
            {movingToInventory ? <ActivityIndicator size="small" colorClassName="accent-on-brand" /> : <FontAwesome6 name="box-archive" size={14} colorClassName="accent-on-brand" />}
            <Text className="text-xs font-black text-white">
              将 {checkedItems.length} 件已买食材一键存入【{activeHousehold ? `${activeHousehold.name}家庭库存` : "冰箱食材库"}】
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 编辑采购项 Modal */}
      <Modal visible={Boolean(editingItem)} animationType="fade" transparent onRequestClose={() => setEditingItem(null)}>
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full rounded-[28px] bg-surface p-5">
            <View className="flex-row items-center justify-between border-b border-line pb-3">
              <Text className="text-base font-black text-ink">编辑采购项目</Text>
              <TouchableOpacity onPress={() => setEditingItem(null)} className="w-8 h-8 items-center justify-center rounded-full bg-canvas">
                <FontAwesome6 name="xmark" size={16} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>

            <View className="mt-4 gap-3">
              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">食材名称</Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-medium"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">分量 / 规格</Text>
                <TextInput
                  value={editAmount}
                  onChangeText={setEditAmount}
                  placeholder="如: 500g, 2盒"
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-medium"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">{activeHousehold ? "确认保质期" : "购买日期"}</Text>
                <TextInput
                  value={editPurchaseDate}
                  onChangeText={setEditPurchaseDate}
                  placeholder="YYYY-MM-DD"
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-medium"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">所属品类</Text>
                <View className="flex-row items-center gap-1.5 flex-wrap">
                  {CATEGORY_OPTIONS.map((cat) => (
                    <TouchableOpacity
                      key={cat.label}
                      onPress={() => setEditCategory(cat.label)}
                      className={`px-3 py-1.5 rounded-full border ${
                        editCategory === cat.label ? "bg-brand-fill border-brand" : "bg-canvas border-line"
                      }`}
                    >
                      <Text className={`text-xs font-bold ${editCategory === cat.label ? "text-white" : "text-ink"}`}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                onPress={handleSaveEditedItem}
                className="mt-2 bg-brand-fill py-3.5 rounded-2xl items-center shadow-xs active:opacity-90"
              >
                <Text className="text-sm font-black text-white">保存修改</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );

  function renderShoppingItemCard(item: CollaborativeShoppingItem) {
    const catOpt = CATEGORY_OPTIONS.find((c) => c.label === item.category) || CATEGORY_OPTIONS[0];
    return (
      <TouchableOpacity
        key={item.id}
        onPress={() => handleToggleCheck(item.id)}
        activeOpacity={0.8}
        className={`p-3.5 rounded-2xl border flex-row items-center justify-between transition-all shadow-2xs ${
          item.checked ? "bg-background-secondary border-line opacity-60" : "bg-surface border-line"
        }`}
      >
        <View className="flex-row items-center gap-3 flex-1 mr-2">
          {/* Checkbox */}
          <View
            className={`w-6 h-6 rounded-full items-center justify-center border transition-all ${
              item.checked ? "bg-success-fill border-success/30" : "bg-surface border-line"
            }`}
          >
            {item.checked && <FontAwesome6 name="check" size={11} colorClassName="accent-on-brand" />}
          </View>

          {/* Category Icon Badge */}
          <View className={`w-8 h-8 rounded-xl items-center justify-center ${catOpt.bg}`}>
            <FontAwesome6 name={catOpt.icon} size={13} colorClassName={catOpt.colorClass} />
          </View>

          {/* Item Details */}
          <View className="flex-1">
            <Text className={`text-xs font-black ${item.checked ? "text-copy-muted line-through" : "text-ink"}`}>
              {item.name}
            </Text>
            <Text className="text-[10px] text-copy-muted mt-0.5">
              分量: {item.amount} {item.purchaseDate ? `· 购于 ${item.purchaseDate}` : ""}
            </Text>
            {activeHousehold ? (
              <Text className="mt-1 text-[9px] text-copy-muted">
                创建 {item.creatorName || "成员"} · 修改 {item.updaterName || "成员"}{item.purchaserName ? ` · 购买 ${item.purchaserName}` : ""}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Right Actions */}
        <View className="flex-row items-center gap-1.5">
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              openEditModal(item);
            }}
            className="w-7 h-7 rounded-full bg-canvas items-center justify-center border border-line active:bg-brand-soft"
          >
            <FontAwesome6 name="pen" size={9} colorClassName="accent-copy-muted" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              handleDeleteItem(item.id);
            }}
            className="w-7 h-7 rounded-full bg-danger-soft items-center justify-center border border-critical/30 active:bg-danger-soft"
          >
            <FontAwesome6 name="trash-can" size={9} colorClassName="accent-critical" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }
}
