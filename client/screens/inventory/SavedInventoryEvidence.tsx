import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { InventorySavedEvidence } from "@dietdigidose/contracts";
import { InventoryFieldEvidence } from "@/components/InventoryFieldEvidence";
import { inventoryApi } from "@/services/api";
import type { ApiFetch } from "@/services/api/client";

/** Ephemeral detail only: never persisted in the offline inventory snapshot. */
export function SavedInventoryEvidence({ itemId, version, accountScope, authFetch }: {
  itemId: number; version: number; accountScope: string; authFetch: ApiFetch;
}) {
  const scope = `${accountScope}:${itemId}:${version}`;
  const request = useMemo(() => ({ scope, authFetch }), [scope, authFetch]);
  const [result, setResult] = useState<{ request: typeof request; data?: InventorySavedEvidence; failed?: boolean }>();
  useEffect(() => {
    let active = true;
    void inventoryApi.evidence(authFetch, itemId).then(data => {
      if (active) setResult({ request, ...(data.item_id === itemId && data.inventory_version === version ? { data } : { failed: true }) });
    }).catch(() => { if (active) setResult({ request, failed: true }); });
    return () => { active = false; };
  }, [authFetch, itemId, version, request]);
  const current = result?.request === request ? result : undefined;
  return <View className="gap-2 rounded-2xl bg-canvas p-4" accessibilityLabel="已保存食材依据">
    <Text className="text-sm font-bold text-ink">已保存字段依据</Text>
    {current?.data ? <InventoryFieldEvidence evidence={current.data.field_evidence} /> :
      <Text className="text-caption text-copy-muted">{current?.failed ? "依据暂不可用，请联网后重新打开" : "正在读取依据…"}</Text>}
  </View>;
}
