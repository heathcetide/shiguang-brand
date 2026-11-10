import { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { PreferenceLearningState } from "@dietdigidose/contracts";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { requestJson } from "@/services/api/client";
import { useSafeRouter } from "@/hooks/useSafeRouter";

type Reason = "no_time" | "too_much" | "dislike";
type Pending = { reason: Reason; key: string; version?: number };
const labels: Record<Reason,string> = { no_time: "今天没时间",too_much: "份量太大",dislike: "长期不喜欢这道菜" };
export function RecipePreferenceFeedback({ recipeId }: { recipeId: number }) {
  const { user } = useAuth(); const authFetch = useAuthFetch(); const router = useSafeRouter();
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(""); const [retry,setRetry] = useState(false);
  const pending = useRef<Pending | null>(null); const locked = useRef(false);
  const revision = useRef(0); const owner = useRef(user?.id); owner.current = user?.id;
  useEffect(() => { revision.current += 1; pending.current = null; locked.current = false; setBusy(false); setMessage(""); setRetry(false); return () => { revision.current += 1; }; },[user?.id,recipeId]);
  const submit = async (reason: Reason) => {
    if (!user || locked.current) return;
    const request = revision.current; const id = user.id;
    const live = () => request === revision.current && owner.current === id;
    locked.current = true; setBusy(true); setMessage("");
    const intent = pending.current ?? { reason,key: Crypto.randomUUID() }; pending.current = intent;
    try {
      if (intent.reason === "dislike") {
        if (intent.version === undefined) {
          const state = await requestJson<PreferenceLearningState>(authFetch,"/api/v1/recommendations/preferences");
          if (!live()) return;
          intent.version = state.version;
        }
        await requestJson(authFetch,"/api/v1/recommendations/preferences",{ method: "PATCH",body: JSON.stringify({ kind: "recipe",version: intent.version,recipeId,value: "dislike" }) });
      } else {
        await requestJson(authFetch,"/api/v1/recommendations/events",{ method: "POST",body: JSON.stringify({ recipeId,eventType: "skip",scoringVersion: "explicit-feedback-v1",surface: "meal_plan",idempotencyKey: intent.key,metadata: { reason: intent.reason,scope: "session",source: "recipe_detail" } }) });
      }
      if (live()) { pending.current = null; setRetry(false); setMessage(intent.reason === "dislike" ? "已记为明确口味，可在偏好管理中纠正或删除。" : "已记录本次原因，不会记为长期不喜欢。"); }
    } catch (error) { if (live()) { setRetry(true); setMessage(error instanceof Error ? error.message : "尚未确认保存，请重试或到偏好管理核对。"); } }
    finally { if (live()) { locked.current = false; setBusy(false); } }
  };
  if (!user) return null;
  return <View className="mx-5 my-4 rounded-2xl bg-surface p-4 gap-3">
    <Text className="font-bold text-ink">这次不选这道菜？</Text><Text className="text-copy-muted">按实际原因反馈，临时条件不会变成长期口味。</Text>
    {retry ? <TouchableOpacity disabled={busy} onPress={() => pending.current && void submit(pending.current.reason)}><Text className="text-brand">重试原反馈</Text></TouchableOpacity> : (Object.keys(labels) as Reason[]).map(reason => <TouchableOpacity key={reason} disabled={busy} onPress={() => void submit(reason)}><Text className="text-brand">{labels[reason]}</Text></TouchableOpacity>)}
    {retry ? <TouchableOpacity disabled={busy} onPress={() => { pending.current = null; setRetry(false); setMessage(""); }}><Text className="text-copy-muted">关闭本次反馈</Text></TouchableOpacity> : null}
    {message ? <Text className="text-copy-muted">{message}</Text> : null}
    <TouchableOpacity onPress={() => router.push("/preference-learning")}><Text className="text-brand">查看、纠正或暂停偏好学习</Text></TouchableOpacity>
  </View>;
}
