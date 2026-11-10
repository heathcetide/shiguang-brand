import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useAuthFetch } from "@/contexts/AuthContext";
import { mealPlansApi, type MealPlanChangePreviewInput, type MealPlanChangePreviewResult } from "@/services/api";

/** Mount one instance per immutable proposal. Preview never changes the saved arrangement. */
export function MealPlanChangePreview({ planId, itemId, input, title, onApply, onCancel }: {
  planId: string;
  itemId: string;
  input: MealPlanChangePreviewInput;
  title: string;
  onApply: (fingerprint: string) => Promise<void>;
  onCancel: () => void;
}) {
  const authFetch = useAuthFetch();
  const [preview, setPreview] = useState<MealPlanChangePreviewResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const submitting = useRef(false);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setPreview(null);
    void mealPlansApi.changePreview(authFetch, planId, itemId, input).then(result => {
      if (request === generation.current) { setPreview(result); setError(""); }
    }).catch(reason => {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : "验证失败，请重试");
    }).finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [authFetch, planId, itemId, input, attempt]);
  const cancel = () => {
    if (submitting.current) return;
    generation.current++;
    onCancel();
  };
  const apply = async () => {
    if (submitting.current || loading || !preview?.canApply) return;
    submitting.current = true; setApplying(true);
    const request = generation.current;
    try { await onApply(preview.fingerprint); }
    catch (reason) {
      if (request === generation.current) {
        setError(reason instanceof Error ? reason.message : "提交失败，请刷新验证后重试");
        // A failed write may indicate stale evidence. Never reuse its fingerprint.
        setPreview(null);
      }
    } finally {
      submitting.current = false;
      if (request === generation.current) setApplying(false);
    }
  };
  const ingredients = preview?.ingredientBudget ?? [];
  const coveredCount = ingredients.filter(part => part.fully_covered && part.quantity_status !== "unknown").length;
  const unknownCount = ingredients.filter(part => part.quantity_status === "unknown").length;
  const shortageCount = ingredients.filter(part => !part.fully_covered && part.quantity_status !== "unknown").length;
  return <Modal visible transparent animationType="fade" onRequestClose={cancel}>
    <View className="flex-1 justify-center bg-black/40 px-5">
      <View className="max-h-[85%] rounded-3xl bg-canvas p-5 gap-4">
        <Text className="text-lg font-black text-ink">确认调整前验证</Text>
        <Text className="text-sm text-ink">{title}</Text>
        <ScrollView>
          {loading ? <View className="gap-2"><ActivityIndicator /><Text className="text-copy-muted">正在核对当前餐单，尚未修改安排…</Text></View> : null}
          {error ? <Text accessibilityRole="alert" className="text-danger">{error}。原安排不会被本地替换，请重新验证。</Text> : null}
          {preview ? <View className="gap-3">
            <Text className="text-copy-muted">验证范围：当前餐单窗口 {preview.scope.startDate} 至 {preview.scope.endDate}。核对当前餐单，并预留同日期窗其他已激活安排的用量；不等同采购清单范围，不代表窗外保证。</Text>
            <View className="rounded-2xl bg-background-secondary p-3 gap-2">
              <Text className="font-bold text-ink">整套原料覆盖</Text>
              <Text className="text-copy-muted">{ingredients.length ? `已验证覆盖 ${coveredCount}/${ingredients.length} 项原料需求${unknownCount ? `，${unknownCount} 项数量待核对` : ""}${shortageCount ? `，${shortageCount} 项有缺口` : ""}。` : "未返回原料覆盖明细，请结合下方验证结果核对。"}</Text>
              <Text className="font-bold text-ink">整套耗时核对</Text>
              {preview.time ? <>
                <Text className="text-copy-muted">{`已知顺序制作约 ${preview.time.knownSequentialMinutes} 分钟；整套预算 ${preview.time.budgetMinutes} 分钟${preview.time.sessionBudgetMinutes !== undefined ? `；单次预算 ${preview.time.sessionBudgetMinutes} 分钟` : ""}。`}</Text>
                <Text className="text-copy-muted">{preview.time.incomplete ? "时间或设备依据尚不完整，不能视为完整耗时保证。" : "时间与设备依据完整。"}{preview.time.exceedsBudget ? "服务端排程核对：超过时间上限。" : "服务端排程核对：未超过时间上限。"}顺序制作时间为参考，实际预算以排程核对为准。</Text>
                {preview.time.missing.length ? <Text className="text-copy-muted">{`待核对：${preview.time.missing.join("；")}`}</Text> : null}
              </> : <Text className="text-copy-muted">未返回耗时依据，不能视为时间保证。</Text>}
            </View>
            {preview.canApply ? <Text className="font-bold text-brand">服务端验证通过，可以确认此项调整。</Text> : null}
            {preview.checks.map((check, index) => <View key={`${check.code}-${index}`} className="gap-1">
              <Text className={check.severity === "blocked" ? "text-danger" : "text-ink"}>{check.severity === "blocked" ? "不可应用" : check.severity === "pending" ? "待核对" : "说明"}：{check.message}</Text>
              {check.itemIds.length ? <Text className="text-xs text-copy-muted">涉及餐次：{check.itemIds.join("、")}</Text> : null}
            </View>)}
            {!preview.canApply ? <Text className="font-bold text-danger">验证未通过，保留原安排。</Text> : null}
          </View> : null}
        </ScrollView>
        <View className="flex-row justify-between gap-3">
          <TouchableOpacity accessibilityRole="button" disabled={applying} onPress={cancel}><Text className="text-copy-muted">取消</Text></TouchableOpacity>
          {!loading && !preview ? <TouchableOpacity accessibilityRole="button" disabled={applying} onPress={() => setAttempt(value => value + 1)}><Text className="text-brand">重新验证</Text></TouchableOpacity> : null}
          <TouchableOpacity accessibilityRole="button" disabled={loading || applying || !preview?.canApply} onPress={() => void apply()} className={loading || applying || !preview?.canApply ? "opacity-40" : ""}><Text className="font-bold text-brand">{applying ? "正在提交…" : "确认应用"}</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>;
}
