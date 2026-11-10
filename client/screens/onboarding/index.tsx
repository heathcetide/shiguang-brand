import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { z } from "zod";
import * as Crypto from "expo-crypto";
import { kitchenPreferencesSchema, type OnboardingState, type OnboardingTask, type OnboardingUpdate } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { PreferenceVoiceInput } from "@/components/PreferenceVoiceInput";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useUserDraft } from "@/hooks/useUserDraft";
import { healthApi } from "@/services/api";
import { onboardingApi } from "@/services/api/onboarding";
import { validateAuthReturnTo } from "@/utils/authReturnTo";
import type { HealthProfile } from "@/utils/healthProfile";

const draftSchema = z.object({
  task: z.enum(["inventory", "meal_plan", "diet_record", "nutrition"]).nullable().default(null),
  servings: z.string().default(""), minutes: z.string().default(""),
  safety: z.enum(["unknown", "none", "provided"]).nullable().default(null),
  allergy: z.string().default(""), severity: z.enum(["mild", "moderate", "severe"]).nullable().default(null),
  restrictions: z.array(z.string()).default([]), persistent: z.boolean().default(false),
  kitchen: kitchenPreferencesSchema.default({}),
  avoidSpicy: z.boolean().nullable().default(null), source: z.enum(["inventory", "shopping"]).default("inventory"),
});
const emptyDraft = draftSchema.parse({});
const tasks = [
  { id: "inventory", icon: "carrot", title: "管理家里的食材", detail: "拍几样手边的食材，就能开始" },
  { id: "meal_plan", icon: "utensils", title: "安排一餐", detail: "按人数、时间和忌口，解决今天吃什么" },
  { id: "diet_record", icon: "bowl-food", title: "记录刚吃的一餐", detail: "拍照、搜索或手动记下这一餐" },
  { id: "nutrition", icon: "seedling", title: "设置营养目标", detail: "有需要时再补充身体信息和目标" },
] as const;

export default function OnboardingScreen() {
  const { user } = useAuth(); const router = useSafeRouter();
  return user ? <OnboardingForm key={user.id} /> : <Screen><View className="flex-1 justify-center gap-4 p-6"><Text className="text-ink">登录后可以保存你的首次使用进度。</Text><TouchableOpacity onPress={() => router.replace("/login")}><Text className="text-brand">登录 / 注册</Text></TouchableOpacity></View></Screen>;
}

function OnboardingForm() {
  const { token } = useAuth(); const authFetch = useAuthFetch(); const router = useSafeRouter();
  const { returnTo: rawReturnTo } = useSafeSearchParams<{ returnTo?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const draft = useUserDraft("@onboarding_draft_v2", emptyDraft, value => draftSchema.parse(value));
  const [server, setServer] = useState<OnboardingState | null>(null);
  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [page, setPage] = useState<"tasks" | "conditions">("tasks");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const active = useRef(true); const sending = useRef(false);
  const loadSequence = useRef(0);
  const retryKeys = useRef(new Map<string, string>());
  const updateProgress = async (input: OnboardingUpdate) => {
    const signature = JSON.stringify(input);
    const requestKey = retryKeys.current.get(signature) || Crypto.randomUUID();
    retryKeys.current.set(signature, requestKey);
    const result = await onboardingApi.update(token!, { ...input, requestKey });
    retryKeys.current.delete(signature);
    return result;
  };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!token) return;
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const state = await onboardingApi.get(token);
      if (!active.current || sequence !== loadSequence.current) return;
      setServer(state);
      if (state.selectedTask === "meal_plan" && state.step === "conditions" && state.status !== "completed") {
        const data = await healthApi.profile<HealthProfile>(authFetch, { fresh: true });
        if (!active.current || sequence !== loadSequence.current) return;
        setProfile(data); setPage("conditions");
      }
      if (state.status === "completed") setPage("tasks");
    } catch (reason) { if (active.current && sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : "进度读取失败，请重试"); }
    finally { if (active.current && sequence === loadSequence.current) setLoading(false); }
  }, [token, authFetch]);
  useFocusEffect(useCallback(() => { void load(); return () => { loadSequence.current += 1; }; }, [load]));
  const change = (values: Partial<typeof emptyDraft>) => draft.save({ ...draft.value, ...values });
  const run = async (work: () => Promise<void>) => {
    if (sending.current || !token) return;
    sending.current = true; setBusy(true); setError("");
    try { await work(); }
    catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : "操作未保存，请重试");
      void onboardingApi.saveFailed(token, Crypto.randomUUID()).catch(() => undefined);
    } finally { sending.current = false; if (active.current) setBusy(false); }
  };
  const choose = (task: OnboardingTask) => void run(async () => {
    if (!server || !token) return;
    if (server.status === "completed") {
      const paths = { inventory: "/inventory", meal_plan: "/cooking-plan", diet_record: "/diet-record", nutrition: "/health-profile" };
      router.push(paths[task], task === "nutrition" ? { section: "nutrition" } : {});
      return;
    }
    const state = await updateProgress({ version: server.version, selectedTask: task, status: "in_progress", step: task === "meal_plan" ? "conditions" : "task", dismissed: false });
    if (!active.current) return;
    setServer(state); change({ task });
    if (task === "meal_plan") {
      const data = await healthApi.profile<HealthProfile>(authFetch, { fresh: true });
      if (!active.current) return;
      setProfile(data); setPage("conditions");
    } else if (task === "inventory") router.push("/inventory", { action: "add", onboarding: true });
    else if (task === "diet_record") router.push("/diet-record", { action: "add", onboarding: true });
    else router.push("/health-profile", { section: "nutrition", onboarding: true });
  });
  const pause = () => void run(async () => {
    if (server && token && server.status !== "completed") {
      const state = await updateProgress({ version: server.version, status: "paused", dismissed: true });
      if (!active.current) return;
      setServer(state);
    }
    router.replace(returnTo || "/");
  });
  const continueMeal = () => void run(async () => {
    if (!profile || !server || !token) return;
    const servings = Number(draft.value.servings || profile.kitchen_constraints?.servings || 1);
    const minutes = Number(draft.value.minutes || profile.kitchen_constraints?.meal_time_minutes || 30);
    if (!Number.isInteger(servings) || servings < 1 || servings > 30) throw new Error("人数请填写 1–30 的整数");
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 300) throw new Error("做饭时间请填写 5–300 分钟");
    const safety = draft.value.safety ?? (profile.safety_status === "unknown" ? null : profile.safety_status);
    if (!safety) throw new Error("请选择饮食限制状态，也可以稍后填写");
    const changes: Record<string, unknown> = {};
    if (draft.value.safety === "provided") {
      if (!draft.value.allergy.trim() && !draft.value.restrictions.length) throw new Error("请补充过敏食物或选择饮食限制");
      if (draft.value.allergy.trim() && !draft.value.severity) throw new Error("请选择过敏程度，或稍后到饮食限制中补充");
      changes.allergies = [...(profile.allergies ?? []).filter(item => item.name !== draft.value.allergy.trim()), ...(draft.value.allergy.trim() ? [{ name: draft.value.allergy.trim(), type: "allergy", severity: draft.value.severity }] : [])];
      changes.dietary_restrictions = [...new Set([...(profile.dietary_restrictions ?? []), ...draft.value.restrictions])];
      changes.safety_status = "provided";
    } else if (draft.value.safety === "none" && profile.safety_status !== "provided") changes.safety_status = "none";
    // Editable scalar fields are authoritative, including clearing a prior voice value.
    const kitchenPreferences = { ...draft.value.kitchen };
    delete kitchenPreferences.servings;
    delete kitchenPreferences.meal_time_minutes;
    delete kitchenPreferences.avoid_spicy;
    if (draft.value.persistent) changes.kitchen_constraints = { ...kitchenPreferences, ...(draft.value.servings ? { servings } : {}), ...(draft.value.minutes ? { meal_time_minutes: minutes } : {}), ...(draft.value.avoidSpicy === null ? {} : { avoid_spicy: draft.value.avoidSpicy }) };
    if (Object.keys(changes).length) {
      if (!profile.version) throw new Error("服务端需要升级后才能安全更新资料");
      const saved = await healthApi.patchProfile<HealthProfile>(authFetch, { version: profile.version, ...changes });
      if (!active.current) return;
      setProfile(saved);
    }
    const state = await updateProgress({ version: server.version, status: "in_progress", step: "task" });
    if (!active.current) return;
    setServer(state);
    router.push("/cooking-plan", { onboarding: true, initialServings: servings, initialMinutes: minutes, initialAvoidSpicy: draft.value.avoidSpicy, initialPreferences: draft.value.kitchen, sourceMode: draft.value.source });
  });
  if (loading || !draft.ready) return <Screen><View className="flex-1 items-center justify-center"><ActivityIndicator /></View></Screen>;
  return <Screen safeAreaEdges={["top", "bottom"]} className="bg-background"><ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="p-6 gap-5 mx-auto w-full max-w-2xl">
    <View className="flex-row items-center justify-between"><Text className="font-bold text-brand">食光烙记 · 从一件小事开始</Text><TouchableOpacity disabled={busy} onPress={pause}><Text className="text-copy-muted">稍后开始</Text></TouchableOpacity></View>
    <Text className="text-3xl font-bold text-ink">{page === "tasks" ? "你想先做什么？" : "这一餐，按你的节奏"}</Text>
    <Text className="leading-6 text-copy-muted">{page === "tasks" ? "先完成一件有用的事。资料可以在需要时再补充。" : "只需核对人数、时间和饮食限制。身体资料可以以后再填。"}</Text>
    {error ? <View className="gap-2 rounded-xl bg-danger-soft p-4"><Text accessibilityRole="alert" className="text-critical">{error}</Text><TouchableOpacity disabled={busy} onPress={() => void load()}><Text className="text-brand">重新读取进度与已保存资料</Text></TouchableOpacity></View> : null}
    {draft.error ? <Text className="text-critical">{draft.error}</Text> : null}
    {!server ? <TouchableOpacity onPress={() => void load()}><Text className="text-brand">重新加载</Text></TouchableOpacity> : page === "tasks" ? <>
      {server.status === "completed" ? <Text className="rounded-xl bg-brand-soft p-4 text-brand">第一件事已完成！接下来可以继续探索。</Text> : null}
      {tasks.map(task => <TouchableOpacity accessibilityRole="button" disabled={busy} key={task.id} onPress={() => choose(task.id)} className="min-h-24 flex-row items-center gap-4 rounded-3xl border border-line bg-surface p-5"><View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft"><FontAwesome6 name={task.icon} size={23} colorClassName="accent-brand" /></View><View className="flex-1 gap-1"><Text className="text-lg font-bold text-ink">{task.title}</Text><Text className="leading-5 text-copy-muted">{task.detail}</Text></View><Text className="text-xl text-brand">›</Text></TouchableOpacity>)}
    </> : <>
      <TouchableOpacity disabled={busy} onPress={() => setPage("tasks")}><Text className="text-brand">‹ 换一件事</Text></TouchableOpacity>
      <PreferenceVoiceInput onApply={(value, persistent) => change({ kitchen: value, servings: value.servings == null ? "" : String(value.servings), minutes: value.meal_time_minutes == null ? "" : String(value.meal_time_minutes), avoidSpicy: value.avoid_spicy ?? null, persistent })} />
      <View className="gap-3 rounded-2xl bg-surface p-4"><Text className="font-bold text-ink">几个人吃？</Text><View className="flex-row gap-2">{[1, 2, 3, 4].map(value => <Option key={value} label={`${value} 人`} selected={draft.value.servings === String(value)} onPress={() => change({ servings: String(value) })} />)}</View><TextInput accessibilityLabel="就餐人数" value={draft.value.servings} onChangeText={servings => change({ servings })} keyboardType="number-pad" placeholder={`本次建议：${profile?.kitchen_constraints?.servings || 1} 人`} className="rounded-xl border border-line p-3 text-ink" />
        <Text className="font-bold text-ink">有多少做饭时间？</Text><View className="flex-row gap-2">{[15, 20, 30, 45].map(value => <Option key={value} label={`${value} 分钟`} selected={draft.value.minutes === String(value)} onPress={() => change({ minutes: String(value) })} />)}</View><TextInput accessibilityLabel="做饭分钟数" value={draft.value.minutes} onChangeText={minutes => change({ minutes })} keyboardType="number-pad" placeholder={`本次建议：${profile?.kitchen_constraints?.meal_time_minutes || 30} 分钟`} className="rounded-xl border border-line p-3 text-ink" />
        <Option label={draft.value.persistent ? "✓ 保存本次确认的厨房偏好为常用设置" : "仅本次使用；点此保存为常用设置"} selected={draft.value.persistent} onPress={() => change({ persistent: !draft.value.persistent })} />
      </View>
      <View className="gap-3 rounded-2xl bg-surface p-4"><Text className="font-bold text-ink">有没有饮食限制？</Text>{profile?.safety_status === "provided" ? <Text className="text-brand">沿用档案中已保存的过敏和饮食限制。</Text> : <View className="flex-row flex-wrap gap-2">{([["provided", "有过敏或限制"], ["none", "确认没有"], ["unknown", "稍后填写"]] as const).map(([value, label]) => <Option key={value} label={label} selected={(draft.value.safety ?? (profile?.safety_status === "none" ? "none" : null)) === value} onPress={() => change({ safety: value })} />)}</View>}
        {draft.value.safety === "provided" ? <><TextInput accessibilityLabel="过敏食物" placeholder="过敏食物（可选，请逐项明确）" value={draft.value.allergy} onChangeText={allergy => change({ allergy })} className="rounded-xl border border-line p-3 text-ink" />{draft.value.allergy.trim() ? <View className="flex-row gap-2">{([["mild", "轻度"], ["moderate", "中度"], ["severe", "重度"]] as const).map(([value,label]) => <Option key={value} label={label} selected={draft.value.severity === value} onPress={() => change({ severity: value })} />)}</View> : null}<View className="flex-row flex-wrap gap-2">{["蛋奶素", "纯素", "不吃猪肉", "清真"].map(value => <Option key={value} label={value} selected={draft.value.restrictions.includes(value)} onPress={() => change({ restrictions: draft.value.restrictions.includes(value) ? draft.value.restrictions.filter(item => item !== value) : [...draft.value.restrictions, value] })} />)}</View></> : null}
        <Text className="text-xs leading-5 text-copy-muted">未填写代表尚不清楚，不代表没有过敏。饮食限制确认后保存到档案，可随时管理。</Text>
      </View>
      <View className="flex-row gap-2"><Option label="优先现有食材" selected={draft.value.source === "inventory"} onPress={() => change({ source: "inventory" })} /><Option label="也可以补买" selected={draft.value.source === "shopping"} onPress={() => change({ source: "shopping" })} /></View>
      <TouchableOpacity accessibilityRole="button" disabled={busy || !profile} onPress={continueMeal} className="min-h-14 items-center justify-center rounded-2xl bg-brand-fill p-4"><Text className="font-bold text-white">{busy ? "正在保存…" : "继续安排这一餐"}</Text></TouchableOpacity>
      <Text className="text-xs text-copy-muted">输入自动保存为本机草稿；点击继续后才应用你确认的资料。</Text>
    </>}
  </ScrollView></Screen>;
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} className={`min-h-11 items-center justify-center rounded-xl border px-3 py-3 ${selected ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}><Text className={selected ? "font-bold text-brand" : "text-ink"}>{label}</Text></TouchableOpacity>;
}
