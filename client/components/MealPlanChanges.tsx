import { DiningChangeDetails } from "@/components/DiningChangeDetails";
import { MealPlanChangePreview } from "@/components/MealPlanChangePreview";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { mealPlansApi, type MealPlanChange, type MealPlanItem, type MealPlanChangePreviewInput } from "@/services/api";

const labels: Record<string,string> = { pending: "等待确认", applied: "已应用", rejected: "已拒绝", blocked: "已进入执行，保留原安排", reverted: "已恢复", conflict: "状态已变化" };
function describe(change: MealPlanChange) {
  const before = change.before.input ?? {};
  const after = change.after;
  return [
    after.plannedDate !== undefined && after.plannedDate !== before.plannedDate ? `日期：${before.plannedDate} → ${after.plannedDate}` : "",
    after.mealType !== undefined && after.mealType !== before.mealType ? `餐次：${before.mealType} → ${after.mealType}` : "",
    after.recipeId !== undefined && after.recipeId !== before.recipeId ? `菜谱：${change.before.title || "原菜谱"} → ${after.title || "新菜谱"}` : "",
    after.status !== undefined && after.status !== before.status ? (after.status === "skipped" ? "跳过这餐" : "恢复这餐安排") : "",
  ].filter(Boolean).join(" · ") || "调整餐次";
}
type MealPlanChangesProps = { planId: string; revision: number; items: MealPlanItem[]; onChanged: (item: MealPlanItem) => void };
export function MealPlanChanges(props: MealPlanChangesProps) {
  const { user, isAuthenticated } = useAuth();
  return <MealPlanChangesSession key={`${isAuthenticated}:${user?.id ?? "anonymous"}:${props.planId}`} {...props} />;
}
function MealPlanChangesSession({ planId, revision, items, onChanged }: MealPlanChangesProps) {
  const activeSession = useRef(true);
  useLayoutEffect(() => {
    activeSession.current = true;
    return () => { activeSession.current = false; };
  }, []);
  const authFetch = useAuthFetch();
  const [changes, setChanges] = useState<MealPlanChange[]>([]);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const [proposal, setProposal] = useState<{ change: MealPlanChange; action: "accept" | "restore"; input: MealPlanChangePreviewInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void mealPlansApi.changes(authFetch,planId).then(value => { if (active) setChanges(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "变更记录加载失败"); });
    return () => { active = false; };
  }, [authFetch,planId,revision,refresh]);
  const review = async (change: MealPlanChange, action: "accept" | "reject" | "restore") => {
    if (!activeSession.current || submitting.current || proposal) return;
    if (action !== "reject") {
      setProposal({ change, action, input: { changeId: change.id, action } });
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const next = await mealPlansApi.reviewChange(authFetch,planId,change.id,action);
      if (!activeSession.current) return;
      onChanged(next); setRefresh(value => value + 1);
    } catch (reason) { if (activeSession.current) Alert.alert("原安排已保留", reason instanceof Error ? reason.message : "请刷新后重试"); }
    finally { if (activeSession.current) { submitting.current = false; setBusy(false); } }
  };
  if (!changes.length && !error) return null;
  return <View className="mx-5 my-3 gap-3">
    {proposal ? <MealPlanChangePreview planId={planId} itemId={proposal.change.itemId} input={proposal.input} title={`${proposal.action === "accept" ? "接受变更" : "恢复变更前安排"} · ${describe(proposal.change)}`} onCancel={() => setProposal(null)} onApply={async fingerprint => {
      if (!activeSession.current) return;
      const next = await mealPlansApi.reviewChange(authFetch, planId, proposal.change.id, proposal.action, fingerprint);
      if (!activeSession.current) return;
      setProposal(null); onChanged(next); setRefresh(value => value + 1);
    }} /> : null}
    <Text className="font-bold text-ink">安排变更</Text>
    {error ? <Text className="text-danger">{error}</Text> : null}
    {changes.map(change => <View key={change.id} className="rounded-2xl border border-line bg-surface p-4 gap-2">
      <Text className="font-bold text-ink">{items.find(item => item.id === change.itemId)?.title || "餐次"} · {labels[change.status] || change.status}</Text>
      <Text className="text-copy-muted text-xs">{change.reason} · {change.source === "manual" ? "手动调整" : "系统建议"}</Text>
      <Text className="text-ink text-sm">{describe(change)}</Text>
      {change.after.dining !== undefined ? <><DiningChangeDetails label="变更前" dining={change.before.input?.dining ?? null} /><DiningChangeDetails label="变更后" dining={change.after.dining} /></> : null}
      <View className="flex-row gap-5">
        {change.status === "pending" ? <><TouchableOpacity disabled={busy || Boolean(proposal)} onPress={() => void review(change,"accept")}><Text className="font-bold text-brand">接受变更</Text></TouchableOpacity><TouchableOpacity disabled={busy || Boolean(proposal)} onPress={() => void review(change,"reject")}><Text className="text-copy-muted">保留原安排</Text></TouchableOpacity></> : null}
        {change.status === "applied" ? <TouchableOpacity disabled={busy || Boolean(proposal)} onPress={() => void review(change,"restore")}><Text className="text-brand">恢复变更前安排</Text></TouchableOpacity> : null}
      </View>
    </View>)}
  </View>;
}
