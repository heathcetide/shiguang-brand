import { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useAuthFetch } from "@/contexts/AuthContext";
import { cookingQueueApi } from "@/services/api/cookingQueue";
export function PlanRecipeAction({ interventionId, recipeId, title, onDone }: { interventionId: string; recipeId: number; title: string; onDone: () => void }) {
  const fetch = useAuthFetch();
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const submit = async () => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError("");
    key.current ||= Crypto.randomUUID();
    try {
      await cookingQueueApi.add(fetch, { interventionId, recipeId, confirmed: true, idempotencyKey: key.current });
      if (active.current) onDone();
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "安排失败，请重试"); }
    finally { busy.current = false; if (active.current) setSaving(false); }
  };
  return <View className="gap-3">
    <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setConfirm(true)}><Text className="text-brand">安排这道菜</Text></TouchableOpacity>
    {confirm && <View className="rounded-xl border border-line p-3 gap-3"><Text className="text-ink">将「{title}」加入烹饪队列，具体开始时间由你确定。不会扣减库存或记录摄入；开做前请再次核对食材和忌口。</Text><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => void submit()}><Text className="font-bold text-brand">{saving ? "正在安排…" : "确认加入队列"}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setConfirm(false)}><Text className="text-copy-muted">取消</Text></TouchableOpacity></View>}
    {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
  </View>;
}
