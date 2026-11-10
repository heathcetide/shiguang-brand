import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { PreferenceLearningState, PreferenceLearningUpdate } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { requestJson } from "@/services/api/client";
export default function PreferenceLearningScreen() {
  const { user } = useAuth(); const authFetch = useAuthFetch(); const router = useSafeRouter();
  const [state,setState] = useState<PreferenceLearningState | null>(null);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  const sequence = useRef(0); const owner = useRef(user?.id); owner.current = user?.id;
  useEffect(() => {
    const request = ++sequence.current; const id = user?.id;
    setState(null); setError(""); setBusy(false);
    if (id) void requestJson<PreferenceLearningState>(authFetch,"/api/v1/recommendations/preferences").then(value => { if (request === sequence.current && owner.current === id) setState(value); }).catch(reason => { if (request === sequence.current) setError(String(reason)); });
    return () => { sequence.current += 1; };
  },[user?.id,authFetch]);
  const update = async (input: PreferenceLearningUpdate) => {
    if (!user || busy) return;
    const request = ++sequence.current; const id = user.id; setBusy(true); setError("");
    try { const value = await requestJson<PreferenceLearningState>(authFetch,"/api/v1/recommendations/preferences",{ method: "PATCH",body: JSON.stringify(input) }); if (request === sequence.current && owner.current === id) setState(value); }
    catch (reason) { if (request === sequence.current && owner.current === id) { setError(reason instanceof Error ? reason.message : "更新未确认，请返回后重新打开核对"); } }
    finally { if (request === sequence.current && owner.current === id) setBusy(false); }
  };
  return <Screen className="flex-1 bg-background"><View className="flex-row p-5 gap-6"><TouchableOpacity accessibilityRole="button" accessibilityLabel="返回上一页" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">系统记住了什么</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <Text className="text-copy-muted">这里只列出口味排序依据。过敏和明确饮食限制始终以档案为准；买过、看过、没时间或份量过大不等于不喜欢。</Text>
      {error ? <Text accessibilityRole="alert" className="text-danger">{error}</Text> : null}
      {!user ? <Text className="text-copy-muted">请登录后查看个人偏好。</Text> : !state ? <Text className="text-copy-muted">正在读取偏好…</Text> : <>
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void update({ kind: "learning",version: state.version,enabled: !state.enabled })} className="bg-brand-soft rounded-xl p-4"><Text className="font-bold text-brand">{state.enabled ? "暂停从行为学习" : "恢复从行为学习"}</Text></TouchableOpacity>
        <Text className="text-copy-muted">暂停时不使用推测排序，暂停期间的反馈也不参与恢复后的学习；你明确设置的偏好仍保留。</Text>
        {!state.items.length ? <Text className="text-ink">当前没有用于排序的偏好结论。</Text> : state.items.map(item => <View key={item.recipeId} className="bg-surface rounded-xl p-4 gap-2"><Text className="font-bold text-ink">{item.title}</Text><Text className="text-copy-muted">{item.explanation}</Text>{item.evidence.map(source => <Text key={source.id} className="text-copy-muted text-xs">{source.at.slice(0,10)} · {source.reason}</Text>)}
          {item.origin === "inferred" ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`确认我不喜欢${item.title}`} disabled={busy} onPress={() => void update({ kind: "recipe",version: state.version,recipeId: item.recipeId,value: "dislike" })}><Text className="text-brand">确认：我确实不喜欢</Text></TouchableOpacity> : null}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`纠正或删除${item.title}偏好`} disabled={busy} onPress={() => void update({ kind: "recipe",version: state.version,recipeId: item.recipeId,value: "neutral" })}><Text className="text-brand">纠正或删除：不再据此降低排序</Text></TouchableOpacity>
        </View>)}
        {state.observations?.length ? <View className="gap-3"><Text className="font-bold text-ink">近30天的相关事实</Text><Text className="text-copy-muted">这些事实用于核对结果，目前不会单独改变口味结论。</Text>{state.observations.map(fact => <View key={fact.id} className="rounded-xl bg-surface p-3"><Text className="text-ink">{fact.at.slice(0,10)} · {fact.title}{fact.servings !== undefined ? ` · ${fact.servings} 份` : fact.quantity !== undefined ? ` · ${fact.quantity} ${fact.unit}` : ""}</Text><Text className="text-copy-muted">{fact.explanation}</Text>{fact.remainingServings !== undefined ? <Text className="text-copy-muted">当前待吃余量 {fact.remainingServings} 份（更新于 {fact.observedAt?.slice(0,10)}）；余量本身不说明是否喜欢或份量过大。</Text> : null}</View>)}</View> : null}
        <Text className="text-copy-muted text-xs">删除后保留最小屏蔽记录，避免旧反馈再次生成同一结论。删除账号时一并清除。</Text>
      </>}
    </ScrollView></Screen>;
}
