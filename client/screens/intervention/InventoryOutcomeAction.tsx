import { useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { InterventionCard, InventoryItem } from "@dietdigidose/contracts";
import { useAuthFetch } from "@/contexts/AuthContext";
import { inventoryApi } from "@/services/api/inventory";
import { insightsApi } from "@/services/api/insights";

export function InventoryOutcomeAction({ card, onDone }: { card: InterventionCard; onDone: () => void }) {
  const fetch = useAuthFetch();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<{ item: InventoryItem; outcome: "used" | "discarded" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const active = useRef(true);
  const busy = useRef(false);
  const pending = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let alive = true;
    void inventoryApi.list(fetch, true).then(value => { if (alive) { setItems(value.filter(item => card.inventoryIds.includes(item.id) && item.is_available)); setError(""); } })
      .catch(() => { if (alive) setError("当前库存读取失败，刷新后再确认。"); });
    return () => { alive = false; };
  }, [fetch, card.inventoryIds, reload]);
  const submit = async () => {
    if (!choice || busy.current) return;
    busy.current = true; setSaving(true); setError("");
    const payload = { scope: "personal", itemId: choice.item.id, itemVersion: choice.item.version, outcome: choice.outcome,
      source: "reminder", closeItem: true, confirmed: true, interventionId: card.id };
    const signature = JSON.stringify(payload);
    if (pending.current?.signature !== signature) pending.current = { signature, idempotencyKey: Crypto.randomUUID() };
    try {
      await insightsApi.recordOutcome(fetch, { ...payload, idempotencyKey: pending.current.idempotencyKey });
      if (active.current) onDone();
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { busy.current = false; if (active.current) setSaving(false); }
  };
  return <View className="rounded-2xl border border-line bg-surface p-4 gap-3">
    <Text className="font-bold text-ink">逐批记录处理结果</Text>
    <Text className="text-sm text-copy-muted">仅在这一批已全部使用或丢弃时确认。部分使用请到库存按实际数量记录。</Text>
    {items?.map(item => <View key={item.id} className="gap-2">
      <Text className="text-ink">{item.food_name} · {item.quantity} · 到期 {item.expiration_date}</Text>
      <View className="flex-row gap-5">{(["used", "discarded"] as const).filter(outcome => card.actions.includes(outcome === "used" ? "mark_consumed" : "mark_discarded")).map(outcome => <TouchableOpacity key={outcome} accessibilityRole="button" disabled={saving} onPress={() => setChoice({ item, outcome })}><Text className="text-brand">{outcome === "used" ? "整批已使用" : "整批已丢弃"}</Text></TouchableOpacity>)}</View>
    </View>)}
    {items?.length === 0 && <Text className="text-copy-muted">关联库存已更新，没有可确认的批次。</Text>}
    {choice && <View className="rounded-xl bg-background p-3 gap-3"><Text className="text-ink">确认将「{choice.item.food_name} · {choice.item.quantity}」记录为{choice.outcome === "used" ? "全部已使用" : "全部已丢弃"}并从可用库存移除？此操作不会新增饮食摄入。</Text><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => void submit()}><Text className="text-brand font-bold">{saving ? "正在保存…" : "确认这一批的结果"}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setChoice(null)}><Text className="text-copy-muted">取消</Text></TouchableOpacity></View>}
    {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
    <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => { setChoice(null); setReload(value => value + 1); }}><Text className="text-brand">刷新库存</Text></TouchableOpacity>
  </View>;
}
