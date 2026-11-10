import { normalizeInventoryScanItems } from "@dietdigidose/contracts";

export const SCAN_ACCEPTANCE_RULE = "inventory-scan-v1";

/** Only call with a completed, owned job loaded by the server, never a client-supplied result. */
export function classifyScanAcceptance(jobId: string, rawItems: unknown, existingNames: string[]) {
  const items = normalizeInventoryScanItems(rawItems);
  const normalize = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g, "");
  const counts = new Map<string, number>();
  for (const item of items) counts.set(normalize(item.foodName), (counts.get(normalize(item.foodName)) || 0) + 1);
  const existing = new Set(existingNames.map(normalize));
  return items.map((item, index) => {
    const reasons: string[] = [];
    const name = normalize(item.foodName);
    if (!jobId.trim()) reasons.push("缺少识别任务依据");
    if (item.confidence == null || item.confidence < 0.9) reasons.push("识别把握不足");
    if (/[?？或、/]|可能|疑似|不确定/.test(item.foodName)) reasons.push("名称存在歧义");
    if (counts.get(name)! > 1 || existing.has(name)) reasons.push("可能与其他批次重叠");
    // An explicit count or measure is required; a model's default “适量” is never sufficient.
    const quantityMatch = /^(\d+(?:\.\d+)?|半)\s*(?:g|kg|ml|l|克|千克|毫升|升|个|枚|只|袋|盒|瓶|罐|份)$/i.exec(item.quantity);
    const quantityValue = quantityMatch?.[1] === "半" ? 0.5 : Number(quantityMatch?.[1]);
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) reasons.push("数量需要确认");
    if (!item.suggestedStorageLocation) reasons.push("存放位置未知");
    return { ...item, sourceItemId: `${jobId}:${index}`, acceptance: reasons.length ? "review" as const : "automatic" as const,
      acceptanceRule: SCAN_ACCEPTANCE_RULE, reasons };
  });
}
