import { ReheatingDevicePicker } from "@/components/ReheatingDevicePicker";
import { CookingSchedulePanel } from "@/components/CookingSchedulePanel";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useHealthSummary } from "@/hooks/useHealthSummary";
import { healthApi } from "@/services/api/health";
import { OnboardingProgressCard } from "@/components/OnboardingProgressCard";
import { recommendationsApi } from "@/services/api/recommendations";
import { toLocalDateKey, addLocalDays } from "@/utils/date";
import { cookingPlanDraftSchema, kitchenPreferencesSchema, type KitchenPreferences, type CookingPlanDraft } from "@dietdigidose/contracts";
import * as Crypto from "expo-crypto";
import { mealPlansApi } from "@/services/api/mealPlans";

export default function CookingPlanScreen() {
  const { user } = useAuth();
  return <CookingPlanForm key={user?.id ?? "guest"} />;
}

function CookingPlanForm() {
  const router = useSafeRouter();
  const { planId, onboarding, initialServings, initialMinutes, initialAvoidSpicy, initialPreferences, sourceMode } = useSafeSearchParams<{ planId?: string; onboarding?: boolean; initialServings?: number; initialMinutes?: number; initialAvoidSpicy?: boolean; initialPreferences?: KitchenPreferences; sourceMode?: string }>();
  // Router decoding may allocate a fresh nested object on every render.
  const initialPreferencesKey = JSON.stringify(initialPreferences ?? {});
  const initialKitchenPreferences = useMemo(() => {
    const parsed = kitchenPreferencesSchema.safeParse(JSON.parse(initialPreferencesKey));
    return parsed.success ? parsed.data : {};
  }, [initialPreferencesKey]);
  const saveId = useRef(Crypto.randomUUID());
  const persistedPlan = useRef<{ id: string; version: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activated, setActivated] = useState(false);
  const [replacement, setReplacement] = useState<{ draft: CookingPlanDraft; conflicts: string[] } | null>(null);
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const { profile: healthProfile } = useHealthSummary();
  const [safetyReviewed, setSafetyReviewed] = useState(Boolean(onboarding));
  const [allowShopping, setAllowShopping] = useState(sourceMode !== "inventory");
  const [productionDate, setProductionDate] = useState(toLocalDateKey());
  const [date, setDate] = useState(toLocalDateKey());
  const [servings, setServings] = useState(String(initialServings ?? 1));
  const [minutes, setMinutes] = useState(initialMinutes == null ? "" : String(initialMinutes));
  const [temporaryPreferences, setTemporaryPreferences] = useState<KitchenPreferences>(initialKitchenPreferences);
  const [temporaryAvoidSpicy,setTemporaryAvoidSpicy] = useState<boolean | undefined>(initialAvoidSpicy ?? undefined);
  const [reheatingDeviceIds, setReheatingDeviceIds] = useState<number[]>();
  const [includeLunch, setIncludeLunch] = useState(!onboarding);
  const [result, setResult] = useState<CookingPlanDraft | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const account = useRef(user?.id);
  account.current = user?.id;
  const requestSequence = useRef(0);
  const loadedContext = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    const context = `${user?.id ?? "anonymous"}:${planId ?? "new"}`;
    if (loadedContext.current === context) {
      setLoading(false); setSaving(false);
      return () => { requestSequence.current += 1; };
    }
    setReheatingDeviceIds(undefined);
    setTemporaryPreferences(initialKitchenPreferences);
    setTemporaryAvoidSpicy(initialAvoidSpicy ?? undefined);
    setResult(null); setError(""); setLoading(false); setSaved(false); setSaving(false); setReplacement(null); setActivated(false);
    persistedPlan.current = null;
    const owner = user?.id;
    const sequence = ++requestSequence.current;
    if (planId && owner) {
      setLoading(true);
      void mealPlansApi.get(authFetch, planId).then(plan => {
        if (account.current !== owner || requestSequence.current !== sequence) return;
        const snapshot = plan.constraints.savedCookingDraft as { draft?: unknown } | undefined;
        const draft = cookingPlanDraftSchema.parse(plan.constraints.currentCookingDraft ?? snapshot?.draft);
        if (account.current !== owner || requestSequence.current !== sequence) return;
        if (plan.archived) throw new Error("此方案已归档");
        loadedContext.current = context;
        persistedPlan.current = { id: plan.id, version: plan.version };
        setTemporaryPreferences(draft.effectivePreferences);
        setTemporaryAvoidSpicy(draft.effectivePreferences.avoid_spicy ?? undefined);
        setReheatingDeviceIds(draft.reheatingDeviceIds);
        setResult(draft); setSaved(true); setActivated(plan.status !== "draft");
        setProductionDate(draft.productionDate ?? draft.meals[0].date);
        setDate(draft.meals[0].date); setServings(String(draft.meals[0].servings));
        setMinutes(String(draft.time.budgetMinutes));
        setIncludeLunch(draft.meals.some(meal => meal.mealType === "lunch"));
      }).catch(e => {
        if (account.current === owner && requestSequence.current === sequence) setError(e instanceof Error ? e.message : "恢复方案失败");
      }).finally(() => { if (account.current === owner && requestSequence.current === sequence) setLoading(false); });
    } else { loadedContext.current = context; }
    return () => { requestSequence.current += 1; };
  }, [user?.id, planId, authFetch, initialAvoidSpicy, initialKitchenPreferences]));
  const invalidateDraft = () => {
    setReplacement(null);
    setSaved(false); setSaving(false);
    requestSequence.current += 1;
    setResult(null);
    setError("");
    setLoading(false);
  };
  const calculate = async () => {
    if (!user || loading || saving) return;
    if (!safetyReviewed && (!healthProfile?.safety_status || healthProfile.safety_status === "unknown")) {
      setError("请先选择饮食限制状态，也可以选择稍后填写"); return;
    }
    if (activated) { persistedPlan.current = null; setActivated(false); }
    const owner = user.id;
    const sequence = ++requestSequence.current;
    setLoading(true); setError(""); setResult(null); setSaved(false); setReplacement(null);
    saveId.current = Crypto.randomUUID();
    try {
      const parsed = new Date(`${date}T12:00:00`);
      const nextDate = Number.isFinite(parsed.getTime()) ? toLocalDateKey(addLocalDays(1, parsed)) : "";
      const draft = await recommendationsApi.cookingPlan(authFetch, {
        productionDate, reheatingDeviceIds,
        meals: [{ id: "dinner", date, mealType: "dinner", servings: Number(servings) },
          ...(includeLunch ? [{ id: "lunch", date: nextDate, mealType: "lunch" as const, servings: Number(servings) }] : [])],
        excludedPreparedMealIds: [],
        preferences: { ...temporaryPreferences, servings: Number(servings), ...(reheatingDeviceIds?.length ? { reheating_available: true } : {}), meal_time_minutes: minutes.trim() ? Number(minutes) : undefined,...(temporaryAvoidSpicy === undefined ? {} : { avoid_spicy: temporaryAvoidSpicy }) },
      });
      if (account.current === owner && requestSequence.current === sequence) setResult(draft);
    } catch (e) { if (account.current === owner && requestSequence.current === sequence) setError(e instanceof Error ? e.message : "方案计算失败"); }
    finally { if (account.current === owner && requestSequence.current === sequence) setLoading(false); }
  };
  const replace = async (targetMealId: string) => {
    if (!user || !result || loading || saving) return;
    const owner = user.id;
    const sequence = ++requestSequence.current;
    setLoading(true); setReplacement(null); setError("");
    try {
      const preview = await recommendationsApi.replaceCookingItem(authFetch, { draft: result, targetMealId });
      if (account.current === owner && requestSequence.current === sequence) setReplacement(preview);
    } catch (e) {
      if (account.current === owner && requestSequence.current === sequence) setError(e instanceof Error ? e.message : "替换计算失败，原方案保留");
    } finally { if (account.current === owner && requestSequence.current === sequence) setLoading(false); }
  };
  const activate = async () => {
    if (!user || !persistedPlan.current || !saved || saving || activated) return;
    const owner = user.id;
    const sequence = requestSequence.current;
    setSaving(true); setError("");
    try {
      const existing = persistedPlan.current;
      const response = await mealPlansApi.activateDraft(authFetch, existing.id, existing.version);
      if (account.current === owner && sequence === requestSequence.current) {
        persistedPlan.current = { id: response.plan.id, version: response.plan.version };
        setActivated(true);
        router.push("/meal-plans");
      }
    } catch (e) {
      if (account.current === owner && sequence === requestSequence.current) setError(e instanceof Error ? e.message : "转换餐单失败");
    } finally { if (account.current === owner && sequence === requestSequence.current) setSaving(false); }
  };
  const save = async () => {
    if (!user || !result || saving || saved || loading || replacement) return;
    if (!allowShopping && result.ingredientBudget.some(item => !item.fully_covered)) {
      setError("现有食材尚未确认足量，请补充库存，或选择接受补买清单"); return;
    }
    const owner = user.id;
    const sequence = requestSequence.current;
    setSaving(true); setError("");
    try {
      const existing = persistedPlan.current;
      const response = existing
        ? await mealPlansApi.updateDraft(authFetch, existing.id, { version: existing.version, idempotencyKey: saveId.current, draft: result })
        : await mealPlansApi.saveDraft(authFetch, { id: saveId.current, title: `${result.meals[0].date} 备餐方案`, draft: result });
      if (account.current === owner && sequence === requestSequence.current) {
        const snapshot = response.plan.constraints.savedCookingDraft as { draft?: unknown } | undefined;
        const actual = cookingPlanDraftSchema.parse(response.plan.constraints.currentCookingDraft ?? snapshot?.draft);
        if (account.current !== owner || requestSequence.current !== sequence) return;
        persistedPlan.current = { id: response.plan.id, version: response.plan.version };
        setResult(actual); setSaved(true);
      }
    } catch (e) {
      if (account.current === owner && sequence === requestSequence.current) setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally { if (account.current === owner && sequence === requestSequence.current) setSaving(false); }
  };
  return <Screen className="flex-1 bg-canvas">
    <View className="flex-row items-center gap-4 px-5 py-4"><TouchableOpacity onPress={() => router.back()}><Text className="font-bold text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-black text-ink">这次怎么备餐</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4 pb-12" keyboardShouldPersistTaps="handled">
      <OnboardingProgressCard />
      {(!healthProfile?.safety_status || healthProfile.safety_status === "unknown") && !safetyReviewed ? <View className="gap-3 rounded-2xl bg-surface p-4">
        <Text className="font-bold text-ink">开始前，核对饮食限制</Text>
        <TouchableOpacity onPress={() => router.push("/health-profile", { section: "safety" })}><Text className="text-brand">有过敏或限制，去填写</Text></TouchableOpacity>
        <TouchableOpacity disabled={!healthProfile?.version || loading} onPress={() => {
          if (!healthProfile?.version) return;
          const owner = user?.id; setLoading(true); setError("");
          void healthApi.patchProfile(authFetch, { version: healthProfile.version, safety_status: "none" }).then(() => { if (account.current === owner) setSafetyReviewed(true); }).catch(reason => { if (account.current === owner) setError(reason instanceof Error ? reason.message : "保存失败"); }).finally(() => { if (account.current === owner) setLoading(false); });
        }}><Text className="text-brand">确认没有</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setSafetyReviewed(true)}><Text className="text-copy-muted">稍后填写，先查看方案</Text></TouchableOpacity>
      </View> : null}
      {healthProfile?.safety_status !== "provided" && healthProfile?.safety_status !== "none" ? <Text className="text-xs text-copy-muted">饮食限制尚未确认，方案不代表已排除你的过敏风险。</Text> : null}
      <Text className="text-copy-muted">先用未保留的待吃餐，再计算需要补做的份量。可到待吃餐页标记“这份留着”。</Text>
      <TouchableOpacity onPress={() => router.push("/prepared-meals")}><Text className="font-bold text-brand">查看待吃餐与保留项</Text></TouchableOpacity>
      {result?.planningMode === "weekly" ? <TouchableOpacity onPress={() => router.push("/weekly-plan")}><Text className="font-bold text-brand">重新核对七日安排与采购缺口</Text></TouchableOpacity> : <View className="rounded-2xl bg-surface p-4 gap-3">
        <Text className="font-bold text-ink">晚餐日期</Text><TextInput accessibilityLabel="晚餐日期" value={date} onChangeText={value => { setDate(value); if (productionDate === date) setProductionDate(value); invalidateDraft(); }} className="rounded-xl border border-line p-3 text-ink" placeholder="YYYY-MM-DD" />
        <Text className="font-bold text-ink">本次制作日期</Text><TextInput accessibilityLabel="本次制作日期" value={productionDate} onChangeText={value => { setProductionDate(value); invalidateDraft(); }} className="rounded-xl border border-line p-3 text-ink" placeholder="YYYY-MM-DD" />
        <Text className="font-bold text-ink">每餐需要几份</Text><TextInput accessibilityLabel="每餐份量" value={servings} onChangeText={value => { setServings(value); invalidateDraft(); }} keyboardType="decimal-pad" className="rounded-xl border border-line p-3 text-ink" />
        <Text className="font-bold text-ink">本次时间上限（分钟）</Text><TextInput accessibilityLabel="本次时间上限" value={minutes} onChangeText={value => { setMinutes(value); invalidateDraft(); }} keyboardType="number-pad" placeholder="留空沿用长期设置，未设置为30" className="rounded-xl border border-line p-3 text-ink" />
        <View className="flex-row flex-wrap gap-3">{([[undefined,"辣度沿用档案"],[true,"本次不吃辣"],[false,"本次不限辣度"]] as Array<[boolean | undefined,string]>).map(([value,label]) => <TouchableOpacity key={label} onPress={() => { setTemporaryAvoidSpicy(value); invalidateDraft(); }}><Text className={temporaryAvoidSpicy === value ? "font-bold text-brand" : "text-copy-muted"}>{label}</Text></TouchableOpacity>)}</View>
        <ReheatingDevicePicker value={reheatingDeviceIds} disabled={loading || saving} onChange={ids => { setReheatingDeviceIds(ids); invalidateDraft(); }} />
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: includeLunch }} onPress={() => { setIncludeLunch(value => !value); invalidateDraft(); }}><Text className="font-bold text-brand">{includeLunch ? "已包含" : "未包含"} · 次日午餐</Text></TouchableOpacity>
        <TouchableOpacity disabled={!user || loading} onPress={() => void calculate()} className="rounded-xl bg-brand-fill p-3 items-center">{loading ? <ActivityIndicator color="#fff" /> : <Text className="font-bold text-white">{user ? "按当前库存重新计算" : "请先登录"}</Text>}</TouchableOpacity>
      </View>}
      {error ? <Text className="text-danger">{error}</Text> : null}
      {replacement ? <View className="rounded-2xl bg-warm-soft p-4 gap-3">
        <Text className="font-black text-ink">替换预览 · 其余安排保留</Text>
        {replacement.draft.cooking.filter(item => result?.cooking.find(old => old.targetMealId === item.targetMealId)?.recipeId !== item.recipeId).map(item => <Text key={item.targetMealId} className="text-ink">改为 {item.title} {item.servings} 份</Text>)}
        {replacement.conflicts.map(message => <Text key={message} className="text-danger">{message}</Text>)}
        <Text className="text-copy-muted">制作{replacement.draft.time.schedule?.complete ? "排程" : "已知顺序"}耗时 {replacement.draft.time.schedule?.elapsedMinutes ?? replacement.draft.time.knownSequentialMinutes} 分钟，制作前仍需核对当前条件。</Text>
        {replacement.draft.time.reheatingSessions?.map(session => <CookingSchedulePanel key={session.targetMealId} schedule={session.schedule} heading="替换后的食用前复热" titles={Object.fromEntries(replacement.draft.cooking.map(item => [item.recipeId, item.title]))} />)}
        <TouchableOpacity onPress={() => { setResult(replacement.draft); setReplacement(null); setSaved(false); saveId.current = Crypto.randomUUID(); }}><Text className="font-bold text-brand">采用这次替换草案</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setReplacement(null)}><Text className="text-copy-muted">保留原方案</Text></TouchableOpacity>
      </View> : null}
      {result ? <>
        {!allowShopping && result.ingredientBudget.some(item => !item.fully_covered) ? <View className="gap-3 rounded-xl bg-warm-soft p-4"><Text className="text-ink">现有食材尚未确认足量，下面列出了缺口。可以补充库存后重新计算，或接受补买清单。</Text><TouchableOpacity onPress={() => setAllowShopping(true)}><Text className="font-bold text-brand">接受补买清单</Text></TouchableOpacity><TouchableOpacity onPress={() => router.push("/inventory", { action: "add" })}><Text className="text-brand">补充库存</Text></TouchableOpacity></View> : null}
        <TouchableOpacity disabled={saved || saving || loading || !!replacement} onPress={() => void save()} className="rounded-xl bg-brand-fill p-3 items-center"><Text className="font-bold text-white">{saving ? "正在保存" : saved ? "已保存 · 可从餐单恢复" : "保存此方案草案"}</Text></TouchableOpacity>
        <Text className="text-copy-muted">保存的是计算时的方案；库存变化后请重新核对。</Text>
        {saved ? <TouchableOpacity disabled={saving || loading || activated || !!replacement || !!result.unresolved.length} onPress={() => void activate()} className="rounded-xl bg-brand-soft p-3"><Text className="font-bold text-brand">{activated ? "已转为餐单 · 从餐单开始制作" : "转为餐单，选择要制作的菜"}</Text></TouchableOpacity> : null}
        <View className="rounded-2xl bg-warm-soft p-4 gap-2"><Text className="font-black text-ink">方案草案 · 还需核对</Text><Text className="text-copy-muted">{result.planningMode === "weekly" ? "各餐分次制作，累计已知顺序耗时约" : result.time.schedule?.complete ? "制作排程上限约" : "已知顺序耗时约"} {result.time.schedule?.elapsedMinutes ?? result.time.knownSequentialMinutes} 分钟，{result.planningMode === "weekly" ? `单次上限 ${result.time.sessionBudgetMinutes} 分钟` : `上限 ${result.time.budgetMinutes} 分钟`}{result.time.exceedsBudget ? "，已超时" : ""}。{result.time.incomplete ? "完整收尾、设备安排或加热时间仍需核对。" : "具体制作顺序与并行安排见排程。"}保鲜、携带和加热适用条件也需核实。</Text></View>
        {result.productionDate ? <Text className="text-copy-muted">按 {result.productionDate} 制作核对存放期限；未填写食用时间，期限须覆盖目标日全天。</Text> : null}
        {result.time.schedule ? <CookingSchedulePanel schedule={result.time.schedule} titles={Object.fromEntries(result.cooking.map(item => [item.recipeId, item.title]))} /> : null}
        {result.time.sessions?.map(session => <View key={session.targetMealId} className="gap-2"><Text className="font-bold text-ink">{result.meals.find(meal => meal.id === session.targetMealId)?.date} · 分次制作</Text><CookingSchedulePanel schedule={session.schedule} titles={Object.fromEntries(result.cooking.map(item => [item.recipeId, item.title]))} /></View>)}
        {result.time.reheatingSessions?.map(session => <View key={session.targetMealId} className="gap-2"><Text className="font-bold text-ink">{result.meals.find(meal => meal.id === session.targetMealId)?.date} · 食用前复热 · 上限 {session.budgetMinutes} 分钟{(session.schedule.elapsedMinutes ?? session.schedule.sequentialMinutes) > session.budgetMinutes ? "，已超时" : ""}</Text><CookingSchedulePanel heading="复热排程" schedule={session.schedule} titles={Object.fromEntries(result.cooking.map(item => [item.recipeId, item.title]))} /></View>)}
        {result.meals.map(meal => <View key={meal.id} className="rounded-2xl bg-surface p-4 gap-2"><Text className="font-black text-ink">{meal.date} · {({ breakfast: "早餐",lunch: "午餐",dinner: "晚餐",snack: "加餐" })[meal.mealType]}</Text><Text className="text-brand">需要 {meal.servings} 份 · 待吃餐 {meal.preparedServings} 份 · 补做 {meal.cookServings} 份</Text>
          {meal.allocations.map(item => <Text key={item.preparedMealId} className="text-copy-muted">待吃：{item.foodName} {item.servings} 份（存放条件待核对）</Text>)}
          {result.cooking.filter(item => item.targetMealId === meal.id).map(item => <View key={item.recipeId} className="gap-2">{item.substitution ? <View className="gap-1"><Text className="text-brand">缺料时采用审核变体：{item.substitution.sourceTitle}的{item.substitution.removedIngredient} → {item.substitution.replacementIngredient}</Text><Text className="text-copy-muted text-xs">生成时依据：{item.substitution.reference}。按变体完整用量与步骤制作，制作前重新核对。</Text><Text selectable className="text-copy-muted text-xs">来源：{item.substitution.sourceUrl}</Text></View> : null}<TouchableOpacity onPress={() => router.push({ pathname: "/recipe-detail", params: { id: item.recipeId } })}><Text className="font-bold text-brand">补做：{item.title} {item.servings} 份 · 查看菜谱</Text></TouchableOpacity><TouchableOpacity disabled={loading || saving || activated} onPress={() => void replace(meal.id)}><Text className="font-bold text-brand">这道换一个</Text></TouchableOpacity></View>)}
          {result.handlingChecks?.filter(check => check.targetMealId === meal.id).map((check, index) => <View key={`handling:${index}`} className="gap-1">
            <Text className={check.status === "conflict" ? "text-danger" : "text-copy-muted"}>{check.preparedMealId ? "待吃餐" : "新做菜"}存放：{check.status === "conditions_match" ? "已知计划条件匹配，食用前仍须核对实际存放" : check.status === "conflict" ? "已知条件冲突" : "待核对"}</Text>
            {check.reasons.map(reason => <Text key={reason} className="text-copy-muted text-xs">{reason}</Text>)}
            {check.reference ? <Text className="text-copy-muted text-xs">依据：{check.reference}</Text> : null}
            {check.instructions ? <Text className="text-copy-muted text-xs">{check.instructions}</Text> : null}
            {check.sourceUrl ? <Text selectable className="text-copy-muted text-xs">来源：{check.sourceUrl}</Text> : null}
          </View>)}
          {result.unresolved.filter(item => item.targetMealId === meal.id).map(item => <Text key={item.targetMealId} className="text-danger">{item.reason}</Text>)}
        </View>)}
        <View className="rounded-2xl bg-surface p-4 gap-2"><Text className="font-black text-ink">整套原料预算</Text>{result.ingredientBudget.map((item, index) => <Text key={index} className="text-copy-muted">{item.food_name}：{item.quantity_status === "unknown" ? "数量或换算依据未知" : item.fully_covered ? "已知库存足量" : `缺 ${item.missing_value} ${item.unit}`}</Text>)}</View>
        {result.weeklyShopping ? <View className="rounded-2xl bg-surface p-4 gap-2"><Text className="font-black text-ink">七日合并采购缺口（含原有安排）</Text>{result.weeklyShopping.map(item => <View key={`${item.foodName}:${item.unit}`}><Text className="text-copy-muted">{item.foodName}：需要 {item.required} {item.unit}，库存覆盖 {item.covered}，{item.uncertain ? "缺口待核对" : `还缺 ${item.missing}`}</Text>{item.sources.map((source,index) => <Text key={`${source.mealId}:${index}`} className="text-copy-muted text-xs">{result.meals.find(meal => meal.id === source.mealId)?.date ?? "原有安排"}：{source.required} {item.unit}</Text>)}</View>)}</View> : null}
        <Text className="text-copy-muted text-xs">此页只计算方案。实际制作时请按最新库存核对扣减；实际吃下后再记录饮食。</Text>
      </> : null}
    </ScrollView>
  </Screen>;
}
