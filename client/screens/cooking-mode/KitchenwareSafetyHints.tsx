import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { requestJson } from "@/services/api/client";
type Requirement = { role: string; catalogName: string | null; capabilityCode: string | null; notes: string; satisfied: boolean;
  substitution: { name: string; relationType: string; impact: Record<string, unknown>; safetyNote: string } | null };
export function KitchenwareSafetyHints({ recipeId }: { recipeId: number }) {
  const { user } = useAuth();
  return <Hints key={`${user?.id}:${recipeId}`} recipeId={recipeId} />;
}
function Hints({ recipeId }: { recipeId: number }) {
  const fetch = useAuthFetch();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void requestJson<{ requirements: Requirement[] }>(fetch, `/api/v1/kitchenware/recipes/${recipeId}/compatibility`).then(result => {
      if (active) { setRequirements(result.requirements); setError(false); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [fetch, recipeId, reload]);
  const hints = requirements.filter(item => !item.satisfied || item.substitution);
  if (!error && !hints.length) return null;
  return <View className="rounded-2xl bg-surface border border-line p-4 mb-3 gap-2">
    <Text className="font-bold text-ink">开始前核对厨具</Text>
    {error ? <TouchableOpacity accessibilityRole="button" onPress={() => setReload(value => value + 1)}><Text className="text-copy-muted">暂时无法核对实际厨具，请按菜谱和设备说明确认。点击重试。</Text></TouchableOpacity> : hints.map((item, index) => <View key={index} className="gap-1">
      <Text className="text-ink">{item.role === "required" ? "必需" : item.role === "optional" ? "可选" : "待核对"}：{item.catalogName || item.capabilityCode || "待审核厨具"}{!item.satisfied ? "（尚未满足）" : ""}</Text>
      {!!item.notes && <Text className="text-copy-muted">{item.notes}</Text>}
      {item.substitution && <>
        <Text className="text-brand">{item.substitution.name}：{item.substitution.relationType === "equivalent" ? "已登记等价替代" : "有条件替代，需核对份量、时间和设备说明"}</Text>
        {Object.entries(item.substitution.impact).filter(([, value]) => typeof value === "string").map(([key, value]) => <Text key={key} className="text-copy-muted">{String(value)}</Text>)}
        {!!item.substitution.safetyNote && <Text className="text-warm">{item.substitution.safetyNote}</Text>}
      </>}
    </View>)}
  </View>;
}
