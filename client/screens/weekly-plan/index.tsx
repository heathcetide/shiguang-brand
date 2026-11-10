import { ReheatingDevicePicker } from "@/components/ReheatingDevicePicker";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { WeeklyPlanPreview, WeeklyPlanRequest } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { mealPlansApi, recommendationsApi } from "@/services/api";
import { toLocalDateKey } from "@/utils/date";
const labels: Record<string,string> = { breakfast: "早餐",lunch: "午餐",dinner: "晚餐",snack: "加餐" };
export default function WeeklyPlanScreen() {
  const router = useSafeRouter();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [startDate,setStartDate] = useState(toLocalDateKey());
  const [result,setResult] = useState<WeeklyPlanPreview | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [reheatingDeviceIds, setReheatingDeviceIds] = useState<number[]>();
  const [mealTypes,setMealTypes] = useState<WeeklyPlanRequest["mealTypes"]>();
  const revision = useRef(0);
  const account = useRef(user?.id); account.current = user?.id;
  const draftId = useRef<string | null>(null);
  useEffect(() => { revision.current += 1; setResult(null); setReheatingDeviceIds(undefined); draftId.current = null; setBusy(false); setError(""); },[user?.id]);
  useEffect(() => () => { revision.current += 1; account.current = undefined; },[]);
  const invalidate = () => { revision.current += 1; setResult(null); draftId.current = null; };
  const generate = async () => {
    if (!user || busy) return;
    const owner = user.id; const request = ++revision.current;
    setBusy(true); setError(""); setResult(null);
    try {
      const value = await recommendationsApi.weeklyPlan(authFetch,{ startDate,reheatingDeviceIds,...(mealTypes ? { mealTypes } : {}) });
      if (request !== revision.current || account.current !== owner) return;
      draftId.current = Crypto.randomUUID(); setResult(value);
    } catch (reason) { if (request === revision.current && account.current === owner) setError(reason instanceof Error ? reason.message : "生成失败"); }
    finally { if (account.current === owner && request === revision.current) setBusy(false); }
  };
  const save = async () => {
    if (!user || !result?.draft || !draftId.current || busy) return;
    const owner = user.id; const request = revision.current;
    setBusy(true);
    try {
      const saved = await mealPlansApi.saveDraft(authFetch,{ id: draftId.current,title: `${result.startDate} 起七日安排`,draft: result.draft });
      if (account.current === owner && request === revision.current) router.push({ pathname: "/cooking-plan",params: { planId: saved.plan.id } });
    } catch (reason) { if (account.current === owner && request === revision.current) Alert.alert("保存未确认",reason instanceof Error ? reason.message : "请重试，原保存编号将复用"); }
    finally { if (account.current === owner && request === revision.current) setBusy(false); }
  };
  return <Screen className="flex-1 bg-background">
    <View className="flex-row justify-between p-5"><TouchableOpacity onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="font-bold text-xl text-ink">未来七日安排</Text><View /></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <Text className="text-copy-muted">已有安排保留。空缺餐次共享库存预算，采购清单中的未购食材不算现有库存。</Text>
      <TextInput editable={!busy} accessibilityLabel="七日起始日期" value={startDate} onChangeText={value => { invalidate(); setStartDate(value); }} className="rounded-xl border border-line p-3 text-ink" />
      <Text className="text-copy-muted">默认使用档案中的常用餐次，也可选择本次范围：</Text>
      <View className="flex-row gap-4">{Object.entries(labels).map(([key,label]) => <TouchableOpacity disabled={busy} key={key} onPress={() => {
        invalidate(); const value = key as NonNullable<WeeklyPlanRequest["mealTypes"]>[number];
        setMealTypes(current => { const next = current?.includes(value) ? current.filter(item => item !== value) : [...(current ?? []),value]; return next.length ? next : undefined; });
      }}><Text className={mealTypes?.includes(key as NonNullable<WeeklyPlanRequest["mealTypes"]>[number]) ? "font-bold text-brand" : "text-copy-muted"}>{label}</Text></TouchableOpacity>)}</View>
      <ReheatingDevicePicker key={user?.id ?? "guest"} value={reheatingDeviceIds} disabled={busy} onChange={ids => { invalidate(); setReheatingDeviceIds(ids); }} />
      {!user ? <TouchableOpacity onPress={() => router.push("/login")}><Text className="text-brand">登录后生成安排</Text></TouchableOpacity> : <TouchableOpacity disabled={busy} onPress={() => void generate()} className="bg-brand-fill rounded-xl p-4"><Text className="font-bold text-white text-center">{busy ? "处理中…" : "计算七日安排"}</Text></TouchableOpacity>}
      {error ? <Text className="text-danger">{error}</Text> : null}
      {result ? <>
        {result.slots.map(slot => <View key={slot.id} className="rounded-2xl border border-line bg-surface p-4 gap-2"><Text className="font-bold text-ink">{slot.date} · {labels[slot.mealType]} · {slot.state === "preserved" ? "保留已有安排" : slot.state === "unresolved" ? "尚未解决" : "建议安排"}</Text><Text className="text-brand">{slot.titles.join("、") || "暂无可行菜谱"}</Text>{slot.reasons.map(reason => <Text key={reason} className="text-copy-muted">{reason}</Text>)}</View>)}
        <View className="rounded-2xl bg-surface p-4 gap-3"><Text className="font-bold text-ink">合并采购建议</Text>{result.shopping.map(item => <View key={`${item.foodName}:${item.unit}`}><Text className="text-ink">{item.foodName}：需 {item.required} {item.unit}，库存覆盖 {item.covered}，{item.uncertain ? "实际缺口待核对" : `还缺 ${item.missing}`}</Text>{item.sources.map(source => {
        const slot = result.slots.find(value => value.id === source.mealId || value.preservedItemIds.includes(source.mealId));
        return <Text key={source.mealId} className="text-copy-muted text-xs">{slot ? `${slot.date} ${labels[slot.mealType]}` : "已有安排"}：需要 {source.required} {item.unit}</Text>;
      })}</View>)}<Text className="text-copy-muted">已有 {result.plannedPurchases.length} 项未购清单，本次不会自动覆盖或删除。</Text></View>
        {result.checksPending.map(check => <Text key={check} className="text-copy-muted">待核对：{check}</Text>)}
        {result.draft ? <TouchableOpacity disabled={busy} onPress={() => void save()} className="bg-brand-soft rounded-xl p-4"><Text className="font-bold text-brand">保存新增餐次草案并继续审阅</Text></TouchableOpacity> : <Text className="text-copy-muted">所选餐次已有安排，无需重复新增。</Text>}
      </> : null}
    </ScrollView>
  </Screen>;
}
