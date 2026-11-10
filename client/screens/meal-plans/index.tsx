import { createShoppingRequestKeys, personalShoppingMessage } from "./shoppingRequest";

import { MealPlanChangePreview } from "@/components/MealPlanChangePreview";
import { MealPlanChanges } from "@/components/MealPlanChanges";
import { MealProductionFields } from "@/components/MealProductionFields";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";

import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { mealPlansApi, recipesApi, type MealPlan, type MealPlanItem, type Recipe, type MealPlanItemPatch, type MealPlanChangePreviewInput } from "@/services/api";
import { addLocalDays, parseDateKey, toLocalDateKey } from "@/utils/date";
import { buildMealPlanProduction } from "@/screens/meal-plans/production";

const MEAL_TYPES = ["早餐", "午餐", "晚餐", "加餐"];
const STATUS_LABEL: Record<MealPlanItem["status"], string> = {
  planned: "待执行",
  queued: "已入队",
  cooking: "烹饪中",
  completed: "已完成",
  skipped: "已跳过",
};

function dateLabel(value: string) {
  const date = parseDateKey(value);
  if (!date) return value;
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()} 周${weekday}`;
}

function executionKey(action: string, item: MealPlanItem) {
  return `meal-plan:${action}:${item.id}:v${item.version}`;
}

export default function MealPlansScreen() {
  const { user, isAuthenticated } = useAuth();
  // A keyed session resets all private state before rendering another account.
  return <MealPlansSession key={`${isAuthenticated}:${user?.id ?? "anonymous"}`} />;
}

function MealPlansSession() {
  const activeSession = useRef(true);
  const listRequest = useRef(0);
  useLayoutEffect(() => {
    activeSession.current = true;
    return () => { activeSession.current = false; listRequest.current++; };
  }, []);
  const router = useSafeRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const shoppingRequestKeys = useRef(createShoppingRequestKeys());
  const authFetch = useAuthFetch();
  const [changeRevision, setChangeRevision] = useState(0);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(toLocalDateKey());
  const [viewDays, setViewDays] = useState<3 | 7>(7);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [produced, setProduced] = useState("1");
  const [eaten, setEaten] = useState("0");
  const [withoutStock, setWithoutStock] = useState(false);
  const [detailItem, setDetailItem] = useState<MealPlanItem | null>(null);
  useEffect(() => {
    setProduced(String(detailItem?.productionServings ?? detailItem?.plannedServings ?? 1));
    setEaten("0");
    setWithoutStock(false);
  }, [detailItem?.id]);
  const [replacementRecipes, setReplacementRecipes] = useState<Recipe[]>([]);
  const [replacementOpen, setReplacementOpen] = useState(false);
  const updateBusy = useRef(false);
  const [proposal, setProposal] = useState<{ planId: string; itemId: string; title: string; input: MealPlanChangePreviewInput; patch: MealPlanItemPatch } | null>(null);

  const load = useCallback(async () => {
    if (!activeSession.current) return;
    const request = ++listRequest.current;
    if (!isAuthenticated) {
      setPlans([]);
      setLoading(false);
      return;
    }
    try {
      const next = await mealPlansApi.list(authFetch, true);
      if (!activeSession.current || request !== listRequest.current) return;
      setPlans(next);
      setSelectedPlanId((current) => {
        if (current && next.some((plan) => plan.id === current && !plan.archived)) return current;
        return next.find((plan) => !plan.archived && plan.status === "active")?.id
          || next.find((plan) => !plan.archived)?.id
          || next[0]?.id
          || null;
      });
    } catch (error) {
      if (!activeSession.current || request !== listRequest.current) return;
      Alert.alert("餐单加载失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      if (activeSession.current && request === listRequest.current) setLoading(false);
    }
  }, [authFetch, isAuthenticated]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || null;
  useEffect(() => {
    if (!activeSession.current || !selectedPlan || selectedPlan.archived) return;
    if (selectedDate < selectedPlan.startDate || selectedDate > selectedPlan.endDate) setSelectedDate(selectedPlan.startDate);
  }, [selectedDate, selectedPlan]);

  const visibleDates = useMemo(() => {
    const parsed = parseDateKey(selectedDate) || new Date();
    return Array.from({ length: viewDays }, (_, index) => toLocalDateKey(addLocalDays(index, parsed)));
  }, [selectedDate, viewDays]);

  const replaceItem = (next: MealPlanItem) => {
    if (!activeSession.current) return;
    setPlans((current) => current.map((plan) => plan.id === next.planId
      ? { ...plan, items: plan.items.map((item) => item.id === next.id ? next : item) }
      : plan));
    setDetailItem(next);
  };

  const saveItem = async (planId: string, itemId: string, patch: MealPlanItemPatch, validationFingerprint?: string) => {
    if (!activeSession.current) return;
    const next = await mealPlansApi.updateItem(authFetch, planId, itemId, { ...patch, ...(validationFingerprint ? { validationFingerprint } : {}) });
    if (!activeSession.current) return;
    replaceItem(next);
    setChangeRevision(value => value + 1);
    if (next.change?.status === "pending") {
      setDetailItem(null);
      Alert.alert("变更建议已保存", "这餐已确认或已购买，请在安排变更中审阅后接受。");
    } else if (next.change?.status === "blocked") {
      Alert.alert("原安排已保留", "这餐已进入烹饪队列、开始制作或完成，不能直接调整。");
    } else if (next.change?.status === "applied" && patch.plannedDate) setSelectedDate(patch.plannedDate);
  };

  const updateItem = async (input: Omit<MealPlanItemPatch, "version">, title?: string) => {
    if (!activeSession.current || !selectedPlan || !detailItem || savingAction || updateBusy.current || proposal) return;
    const patch = { ...input, version: detailItem.version };
    const needsPreview = input.recipeId !== undefined || input.plannedDate !== undefined || input.mealType !== undefined || (detailItem.status === "skipped" && input.status === "planned") || Boolean(input.dining);
    if (needsPreview) {
      setProposal({ planId: selectedPlan.id, itemId: detailItem.id, title: title || `${detailItem.title} · ${input.plannedDate || input.mealType || "恢复餐次安排"}`, patch, input: { patch } });
      return;
    }
    updateBusy.current = true; setSavingAction("update");
    try { await saveItem(selectedPlan.id, detailItem.id, patch); }
    catch (error) {
      if (!activeSession.current) return;
      Alert.alert("修改失败", error instanceof Error ? error.message : "请刷新后重试");
      await load();
    } finally { if (activeSession.current) { updateBusy.current = false; setSavingAction(null); } }
  };

  const addShopping = async (item: MealPlanItem) => {
    if (!activeSession.current || !selectedPlan || savingAction) return;
    if (item.dining) { router.push({ pathname: "/household-dining",params: { planItem: { planId: selectedPlan.id,itemId: item.id,version: item.version } } }); return; }
    const account = String(user?.id ?? "anonymous");
    const requestKey = shoppingRequestKeys.current.get(account,item.id,item.version);
    setSavingAction(`shopping:${item.id}`);
    try {
      const result = await mealPlansApi.addShopping(authFetch, selectedPlan.id, item.id, {
        version: item.version,
        idempotencyKey: requestKey,
      });
      if (!activeSession.current) return;
      shoppingRequestKeys.current.complete(account,item.id,item.version,requestKey);
      Alert.alert("本餐单库存核算", personalShoppingMessage(result), [
        { text: "留在餐单" },
        { text: "查看采购", onPress: () => router.push("/shopping-list") },
      ]);
    } catch (error) {
      if (!activeSession.current) return;
      Alert.alert("同步失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      if (activeSession.current) setSavingAction(null);
    }
  };

  const addQueue = async (item: MealPlanItem, start = false, combineSameRecipe?: boolean) => {
    if (!activeSession.current || !selectedPlan || savingAction) return;
    if (!item.recipeId || !item.recipeAvailable) {
      Alert.alert("菜谱不可执行", "请先为这个餐次替换一份可用菜谱");
      return;
    }
    const savedDraft = (selectedPlan.constraints.currentCookingDraft ?? (selectedPlan.constraints.savedCookingDraft as { draft?: { planningMode?: string } } | undefined)?.draft) as { planningMode?: string } | undefined;
    const common = savedDraft && savedDraft.planningMode !== "weekly" ? selectedPlan.items.filter(other => other.recipeId === item.recipeId && other.status === "planned" && !other.queueItemId && !other.dining && (other.plannedServings ?? 0) > 0) : [];
    if (combineSameRecipe === undefined && common.length > 1 && !item.queueItemId) {
      Alert.alert("相同菜谱共用制作", common.map(other => `${other.plannedDate} ${other.mealType} ${other.plannedServings}份`).join("\n"), [
        { text: "取消", style: "cancel" },
        { text: "只做这一餐", onPress: () => void addQueue(item, start, false) },
        { text: `共做 ${common.reduce((sum, other) => sum + (other.plannedServings ?? 0), 0)} 份`, onPress: () => void addQueue(item, start, true) },
      ]);
      return;
    }
    setSavingAction(`queue:${item.id}`);
    try {
      await mealPlansApi.addQueue(authFetch, selectedPlan.id, item.id, {
        version: item.version,
        idempotencyKey: executionKey("queue", item),
        combineSameRecipe: combineSameRecipe ?? false,
      });
      if (!activeSession.current) return;
      await load();
      if (!activeSession.current) return;
      if (start) router.push("/cooking-queue");
      else Alert.alert("已加入烹饪队列", "可在队列中继续备料或开始烹饪", [
        { text: "知道了" },
        { text: "查看队列", onPress: () => router.push("/cooking-queue") },
      ]);
    } catch (error) {
      if (!activeSession.current) return;
      Alert.alert("加入失败", error instanceof Error ? error.message : "请刷新后重试");
      await load();
    } finally {
      if (activeSession.current) setSavingAction(null);
    }
  };

  const complete = async (item: MealPlanItem) => {
    if (!activeSession.current || !selectedPlan || savingAction || item.status === "completed") return;
    if (!withoutStock) { Alert.alert("先确认原料", "使用库存食材时请从烹饪入口确认扣减；此处只保存未使用库存原料的制作。"); return; }
    setSavingAction(`complete:${item.id}`);
    try {
      await mealPlansApi.complete(authFetch, selectedPlan.id, item.id, {
        version: item.version,
        idempotencyKey: executionKey("complete", item),
        production: buildMealPlanProduction(item, produced, eaten),
      });
      if (!activeSession.current) return;
      await load();
      if (!activeSession.current) return;
      setDetailItem(null);
      Alert.alert("餐次已完成", "制作已保存，剩余份量留待吃；只有实际食用计入摄入", [
        { text: "完成" },
        { text: "查看待吃餐", onPress: () => router.push("/prepared-meals") },
      ]);
    } catch (error) {
      if (!activeSession.current) return;
      Alert.alert("记录失败", error instanceof Error ? error.message : "请刷新后重试");
      await load();
    } finally {
      if (activeSession.current) setSavingAction(null);
    }
  };

  const openReplacements = async () => {
    if (!activeSession.current) return;
    setReplacementOpen(true);
    if (replacementRecipes.length) return;
    try {
      const recipes = await recipesApi.list<Recipe>("?limit=30");
      if (activeSession.current) setReplacementRecipes(recipes.slice(0, 20));
    } catch (error) {
      if (!activeSession.current) return;
      Alert.alert("菜谱加载失败", error instanceof Error ? error.message : "请稍后重试");
      setReplacementOpen(false);
    }
  };

  if (authLoading || loading) {
    return <Screen><View className="flex-1 items-center justify-center"><ActivityIndicator colorClassName="accent-brand" /></View></Screen>;
  }

  if (!isAuthenticated) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8">
          <FontAwesome6 name="calendar-days" size={42} colorClassName="accent-brand" />
          <Text className="mt-5 text-xl font-black text-ink">登录后查看餐单</Text>
          <Text className="mt-2 text-center text-sm leading-6 text-copy-muted">Agent 创建的餐单会安全保存在账号中，并同步到所有设备。</Text>
          <TouchableOpacity onPress={() => router.push("/login")} className="mt-6 rounded-2xl bg-brand-fill px-8 py-3.5">
            <Text className="font-black text-white">去登录</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between px-5 pb-4 pt-2">
          <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full border border-line bg-surface">
            <FontAwesome6 name="arrow-left" size={15} colorClassName="accent-ink" />
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-lg font-black text-ink">餐单工作台</Text>
            <Text className="text-[10px] font-bold text-copy-muted">计划 · 采购 · 烹饪 · 记录</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/ai-assistant")} className="h-10 w-10 items-center justify-center rounded-full bg-brand-fill">
            <FontAwesome6 name="wand-magic-sparkles" size={14} colorClassName="accent-on-brand" />
          </TouchableOpacity>
        </View>

        {plans.length ? (
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
              {plans.map((plan) => (
              <TouchableOpacity key={plan.id} onPress={() => setSelectedPlanId(plan.id)} className={`rounded-2xl border px-4 py-3 ${plan.id === selectedPlanId ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}>
                <View className="flex-row items-center gap-2">
                  <Text className={`text-sm font-black ${plan.archived ? "text-copy-muted" : "text-ink"}`}>{plan.title}</Text>
                  {plan.source === "agent" ? <FontAwesome6 name="wand-magic-sparkles" size={10} colorClassName="accent-brand" /> : null}
                </View>
                <Text className="mt-1 text-[10px] text-copy-muted">{plan.startDate} 至 {plan.endDate}{plan.undoState === "undone" ? " · 已撤销" : ""}</Text>
              </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <TouchableOpacity onPress={() => router.push("/plan-maintenance")} className="mx-5 mt-4"><Text className="font-bold text-brand">每日计划检查 · 设置时间</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/preference-learning")} className="mx-5 mt-4"><Text className="font-bold text-brand">系统记住了什么 · 管理偏好</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/weekly-plan")} className="mx-5 mt-4 rounded-2xl bg-brand-soft p-4"><Text className="font-black text-brand">计算未来七日安排与合并采购</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/cooking-plan")} className="mx-5 mt-4 rounded-2xl bg-brand-soft p-4"><Text className="font-black text-brand">按待吃餐和库存计算这次备餐</Text></TouchableOpacity>
        {selectedPlan ? <MealPlanChanges key={selectedPlan.id} planId={selectedPlan.id} revision={changeRevision} items={selectedPlan.items} onChanged={next => { replaceItem(next); setDetailItem(null); }} /> : null}
        {selectedPlan?.constraints.savedCookingDraft && !selectedPlan.archived ? <TouchableOpacity onPress={() => router.push({ pathname: "/cooking-plan", params: { planId: selectedPlan.id } })} className="mx-5 rounded-2xl bg-brand-soft p-4"><Text className="font-bold text-brand">恢复备餐方案草案 · 查看份量、原料与时间</Text></TouchableOpacity> : null}
        {!selectedPlan ? (
          <View className="mx-5 mt-10 items-center rounded-3xl border border-dashed border-line bg-surface p-8">
            <FontAwesome6 name="calendar-plus" size={34} colorClassName="accent-copy-muted" />
            <Text className="mt-4 text-base font-black text-ink">还没有餐单</Text>
            <Text className="mt-2 text-center text-xs leading-5 text-copy-muted">让食语先为你生成 3 天或一周餐单，创建后重新进入仍可查看。</Text>
            <TouchableOpacity onPress={() => router.push("/ai-assistant")} className="mt-5 rounded-2xl bg-brand-fill px-5 py-3"><Text className="font-black text-white">让食语配餐</Text></TouchableOpacity>
          </View>
        ) : selectedPlan.archived ? (
          <View className="mx-5 mt-5 rounded-3xl border border-line bg-background-secondary p-5">
            <Text className="font-black text-copy-muted">该 Agent 餐单已撤销</Text>
            <Text className="mt-2 text-xs leading-5 text-copy-muted">保留只读状态用于审计；不会再进入采购、烹饪或记录流程。</Text>
          </View>
        ) : selectedPlan.constraints.savedCookingDraft && selectedPlan.items.length === 0 ? (
          <View className="mx-5 mt-5 rounded-3xl border border-line bg-surface p-5">
            <Text className="font-black text-ink">备餐草案已保存</Text>
            <Text className="mt-2 text-xs leading-5 text-copy-muted">打开上方方案查看待吃餐分配、补做份量和原料预算。执行前需按最新库存核对。</Text>
          </View>
        ) : (
          <>
            <View className="mx-5 mt-5 flex-row items-center justify-between rounded-2xl bg-background-secondary p-1">
              {([3, 7] as const).map((days) => (
                <TouchableOpacity key={days} onPress={() => setViewDays(days)} className={`flex-1 items-center rounded-xl py-2 ${viewDays === days ? "bg-surface shadow-2xs" : ""}`}>
                  <Text className={`text-xs font-black ${viewDays === days ? "text-brand" : "text-copy-muted"}`}>{days === 3 ? "3 日" : "一周"}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 14, gap: 8 }}>
                {visibleDates.map((date) => {
                const done = selectedPlan.items.filter((item) => item.plannedDate === date && item.status === "completed").length;
                const total = selectedPlan.items.filter((item) => item.plannedDate === date && item.status !== "skipped").length;
                return (
                  <TouchableOpacity key={date} onPress={() => setSelectedDate(date)} className={`min-w-[76px] items-center rounded-2xl border px-3 py-3 ${date === selectedDate ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}>
                    <Text className={`text-xs font-black ${date === selectedDate ? "text-white" : "text-ink"}`}>{dateLabel(date)}</Text>
                    <Text className={`mt-1 text-[9px] ${date === selectedDate ? "text-white/80" : "text-copy-muted"}`}>{total ? `${done}/${total} 完成` : "未安排"}</Text>
                  </TouchableOpacity>
                );
                })}
              </ScrollView>
            </View>

            <View className="px-5">
              {MEAL_TYPES.map((mealType) => {
                const items = selectedPlan.items.filter((item) => item.plannedDate === selectedDate && item.mealType === mealType);
                if (!items.length) return null;
                return (
                  <View key={mealType} className="mb-4">
                    <Text className="mb-2 text-xs font-black text-copy-muted">{mealType}</Text>
                    {items.map((item) => (
                      <TouchableOpacity key={item.id} onPress={() => setDetailItem(item)} className="mb-2 rounded-3xl border border-line bg-surface p-4 shadow-2xs">
                        <View className="flex-row items-start justify-between gap-3">
                          <View className="min-w-0 flex-1">
                            <Text className="text-base font-black text-ink" numberOfLines={1}>{item.title}</Text>
                            <Text className="mt-1 text-[11px] text-copy-muted">{item.nutrition.calories ?? "--"} kcal · {item.cookTime || "--"} 分钟 · {item.difficulty || "难度未知"}</Text>
                          </View>
                          <View className={`rounded-full px-2.5 py-1 ${item.status === "completed" ? "bg-brand-soft" : item.status === "skipped" ? "bg-background-secondary" : "bg-warm-soft"}`}>
                            <Text className={`text-[9px] font-black ${item.status === "completed" ? "text-brand" : item.status === "skipped" ? "text-copy-muted" : "text-warm"}`}>{STATUS_LABEL[item.status]}</Text>
                          </View>
                        </View>
                        <View className="mt-3 flex-row gap-2">
                          <TouchableOpacity onPress={() => void addShopping(item)} className="flex-1 flex-row items-center justify-center rounded-xl bg-warm-soft py-2.5">
                            <FontAwesome6 name="basket-shopping" size={10} colorClassName="accent-warm" /><Text className="ml-1.5 text-[10px] font-black text-warm">补齐采购</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => void addQueue(item)} className="flex-1 flex-row items-center justify-center rounded-xl bg-brand-soft py-2.5">
                            <FontAwesome6 name="list-check" size={10} colorClassName="accent-brand" /><Text className="ml-1.5 text-[10px] font-black text-brand">加入队列</Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })}
              {!selectedPlan.items.some((item) => item.plannedDate === selectedDate) ? (
                <View className="items-center rounded-3xl border border-dashed border-line p-8"><Text className="text-sm font-bold text-copy-muted">当天没有安排餐次</Text></View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      {proposal ? <MealPlanChangePreview planId={proposal.planId} itemId={proposal.itemId} input={proposal.input} title={proposal.title} onCancel={() => setProposal(null)} onApply={async fingerprint => {
        await saveItem(proposal.planId, proposal.itemId, proposal.patch, fingerprint);
        if (activeSession.current) setProposal(null);
      }} /> : null}
      <Modal visible={Boolean(detailItem) && !proposal} transparent animationType="slide" onRequestClose={() => setDetailItem(null)}>
        <View className="flex-1 justify-end bg-black/40">
          {detailItem ? (
            <View className="max-h-[88%] rounded-t-[32px] bg-canvas px-5 pb-8 pt-5">
              <View className="flex-row items-start justify-between gap-4">
                <View className="min-w-0 flex-1"><Text className="text-xl font-black text-ink">{detailItem.title}</Text><Text className="mt-1 text-xs text-copy-muted">{dateLabel(detailItem.plannedDate)} · {detailItem.mealType} · {STATUS_LABEL[detailItem.status]}</Text></View>
                <TouchableOpacity onPress={() => setDetailItem(null)} className="h-9 w-9 items-center justify-center rounded-full bg-background-secondary"><FontAwesome6 name="xmark" size={14} colorClassName="accent-copy-muted" /></TouchableOpacity>
              </View>
              <ScrollView className="mt-4" showsVerticalScrollIndicator={false}>
                <TouchableOpacity disabled={!selectedPlan || Boolean(savingAction)} className="rounded-2xl bg-brand-soft p-3 mb-3" onPress={() => {
                  if (!selectedPlan) return;
                  const planItem = { planId: selectedPlan.id,itemId: detailItem.id,version: detailItem.version };
                  setDetailItem(null); router.push({ pathname: "/household-dining",params: { planItem } });
                }}><Text className="font-bold text-brand">预览这餐的家庭共餐需求</Text></TouchableOpacity>
                <TouchableOpacity disabled={Boolean(detailItem.confirmedAt) || Boolean(savingAction)} className="rounded-2xl bg-brand-soft p-3 mb-3" onPress={async () => {
                  if (!activeSession.current || !selectedPlan || savingAction) return;
                  setSavingAction("confirm");
                  try { const next = await mealPlansApi.confirmItem(authFetch,selectedPlan.id,detailItem.id,detailItem.version); if (activeSession.current) { replaceItem(next); setChangeRevision(value => value + 1); } }
                  catch (reason) { if (activeSession.current) Alert.alert("确认失败",reason instanceof Error ? reason.message : "请刷新后重试"); }
                  finally { if (activeSession.current) setSavingAction(null); }
                }}><Text className="font-bold text-brand">{detailItem.confirmedAt ? "已确认 · 自动调整需先审阅" : "确认这餐安排"}</Text></TouchableOpacity>
                <View className="flex-row gap-2">
                  {MEAL_TYPES.map((mealType) => <TouchableOpacity key={mealType} onPress={() => void updateItem({ mealType })} className={`rounded-xl px-3 py-2 ${detailItem.mealType === mealType ? "bg-brand-fill" : "bg-background-secondary"}`}><Text className={`text-[10px] font-black ${detailItem.mealType === mealType ? "text-white" : "text-copy-muted"}`}>{mealType}</Text></TouchableOpacity>)}
                </View>
                <View className="mt-3 flex-row items-center justify-between rounded-2xl bg-background-secondary p-3">
                  <TouchableOpacity onPress={() => { const date = parseDateKey(detailItem.plannedDate); if (date) void updateItem({ plannedDate: toLocalDateKey(addLocalDays(-1, date)) }); }}><FontAwesome6 name="chevron-left" size={12} colorClassName="accent-brand" /></TouchableOpacity>
                  <Text className="text-xs font-black text-ink">调整日期 · {dateLabel(detailItem.plannedDate)}</Text>
                  <TouchableOpacity onPress={() => { const date = parseDateKey(detailItem.plannedDate); if (date) void updateItem({ plannedDate: toLocalDateKey(addLocalDays(1, date)) }); }}><FontAwesome6 name="chevron-right" size={12} colorClassName="accent-brand" /></TouchableOpacity>
                </View>
                <View className="mt-4 rounded-2xl border border-line bg-surface p-4">
                  <Text className="text-xs font-black text-ink">营养估算</Text>
                  <Text className="mt-2 text-xs text-copy-muted">热量 {detailItem.nutrition.calories ?? "--"} kcal · 蛋白质 {detailItem.nutrition.protein ?? "--"} g · 碳水 {detailItem.nutrition.carbs ?? "--"} g · 脂肪 {detailItem.nutrition.fat ?? "--"} g</Text>
                </View>
                <View className="mt-4"><Text className="text-xs font-black text-ink">食材</Text>{detailItem.ingredients.map((item, index) => <Text key={`${item.name}-${index}`} className="mt-2 text-xs text-copy-muted">• {item.name} {item.amount}</Text>)}</View>
                <View className="mt-4"><Text className="text-xs font-black text-ink">步骤</Text>{detailItem.steps.map((step, index) => <Text key={index} className="mt-2 text-xs leading-5 text-copy-muted">{index + 1}. {typeof step === "string" ? step : JSON.stringify(step)}</Text>)}</View>
                {detailItem.status === "planned" || detailItem.status === "skipped" ? <TouchableOpacity disabled={Boolean(savingAction)} onPress={() => void updateItem({ status: detailItem.status === "skipped" ? "planned" : "skipped" })} className="mt-4 rounded-2xl bg-background-secondary p-3"><Text className="font-bold text-brand">{detailItem.status === "skipped" ? "恢复这餐安排" : "跳过这餐"}</Text></TouchableOpacity> : null}
                <TouchableOpacity onPress={() => void openReplacements()} className="mt-5 items-center rounded-2xl border border-brand py-3"><Text className="text-xs font-black text-brand">替换这道菜</Text></TouchableOpacity>
                <View className="mt-3 flex-row gap-2">
                  <TouchableOpacity onPress={() => void addShopping(detailItem)} className="flex-1 items-center rounded-2xl bg-warm-soft py-3"><Text className="text-xs font-black text-warm">生成缺失采购</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => void addQueue(detailItem, true)} className="flex-1 items-center rounded-2xl bg-brand-soft py-3"><Text className="text-xs font-black text-brand">开始烹饪</Text></TouchableOpacity>
                </View>
                {detailItem.status !== "completed" ? <>
                  {(detailItem?.productionMealCount ?? 1) > 1 && <Text className="mb-3 text-copy-muted">共用一次制作 · {detailItem?.productionMealCount} 个餐次 · 共 {detailItem?.productionServings} 份；保存后分别保留各餐次安排。</Text>}
              <MealProductionFields produced={produced} eaten={eaten} onProducedChange={setProduced} onEatenChange={setEaten} />
                  <TouchableOpacity onPress={() => setWithoutStock(value => !value)}><Text className="text-brand">{withoutStock ? "已确认：" : "点击确认："} 本次未使用库存原料</Text></TouchableOpacity>
                </> : null}
                {detailItem.dining ? <Text className="mb-3 text-copy-muted">已安排 {detailItem.dining.participants.length} 人共餐，共 {detailItem.dining.participants.reduce((sum,person) => sum+Math.round(person.servings*1_000_000),0)/1_000_000} 份；请从共餐入口记录家庭制作。</Text> : null}
                {detailItem.dining && detailItem.status !== "completed" ? <TouchableOpacity accessibilityRole="button" disabled={Boolean(savingAction)} onPress={() => void updateItem({ dining: null })}><Text className="font-bold text-brand">取消这餐的共餐安排</Text></TouchableOpacity> : null}
                {detailItem.householdMealId && detailItem.householdId ? <TouchableOpacity accessibilityRole="button" onPress={() => { const householdId = detailItem.householdId!; setDetailItem(null); router.push({ pathname: "/household-meals",params: { householdId } }); }}><Text className="font-bold text-brand">查看这餐的家庭待吃</Text></TouchableOpacity> : null}
                {detailItem.status !== "completed" ? <TouchableOpacity onPress={() => void complete(detailItem)} className="mb-4 mt-3 items-center rounded-2xl bg-brand-fill py-3.5"><Text className="font-black text-white">保存制作与食用分配</Text></TouchableOpacity> : <View className="mb-4 mt-3 items-center rounded-2xl bg-brand-soft py-3.5"><Text className="font-black text-brand">{detailItem.householdMealId ? "家庭制作已保存，请到家庭待吃记录本人食用" : detailItem.dietRecordId ? `已关联饮食记录 #${detailItem.dietRecordId}` : "制作已保存，请到待吃餐确认食用"}</Text></View>}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal visible={replacementOpen} transparent animationType="fade" onRequestClose={() => setReplacementOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-5">
          <View className="max-h-[75%] w-full rounded-3xl bg-canvas p-5">
            <View className="flex-row items-center justify-between"><Text className="text-lg font-black text-ink">选择替换菜谱</Text><TouchableOpacity onPress={() => setReplacementOpen(false)}><FontAwesome6 name="xmark" size={16} colorClassName="accent-copy-muted" /></TouchableOpacity></View>
            <ScrollView className="mt-4">
              {replacementRecipes.map((recipe) => <TouchableOpacity key={recipe.id} onPress={() => { setReplacementOpen(false); void updateItem({ recipeId: recipe.id }, `${detailItem?.title || "原菜谱"} → ${recipe.title}`); }} className="mb-2 rounded-2xl border border-line bg-surface p-4"><Text className="font-black text-ink">{recipe.title}</Text><Text className="mt-1 text-[10px] text-copy-muted">{recipe.calories} kcal · {recipe.cook_time} 分钟 · {recipe.difficulty}</Text></TouchableOpacity>)}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
