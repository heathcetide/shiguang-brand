import { inventoryBulkIntakeResponseSchema, type InventoryItem } from "@dietdigidose/contracts";

export function savedIntakeItems(rows: Array<{ confirmed_payload_json: unknown; result_json: unknown }>) {
  const saved = new Map<string, InventoryItem>();
  for (const row of rows) {
    const payload = typeof row.confirmed_payload_json === "string" ? JSON.parse(row.confirmed_payload_json) : row.confirmed_payload_json;
    const result = inventoryBulkIntakeResponseSchema.parse(typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json);
    if (!Array.isArray(payload)) throw new Error("入库批次缺少项目证据");
    payload.forEach((item: { source_item_id?: string }, index: number) => {
      if (item.source_item_id && result.items[index] && !saved.has(item.source_item_id)) saved.set(item.source_item_id, result.items[index]);
    });
  }
  return saved;
}
