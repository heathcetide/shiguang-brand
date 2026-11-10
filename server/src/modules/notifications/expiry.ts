export interface ExpiryItem { id: number; name: string; expiration: string }

export function expiryContent(today: string, items: ExpiryItem[]) {
  const first = items[0]!;
  const days = Math.max(0, Math.round((Date.parse(`${first.expiration}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
  const priority = days === 0 ? "urgent" : days === 1 ? "high" : "normal";
  const title = days === 0 ? "今天到期，请尽快处理" : days === 1 ? "明天到期，优先安排" : "3 天内临期提醒";
  const body = items.length > 1
    ? `【${first.name}】等 ${items.length} 种食材即将到期，可安排食谱或标记已处理。`
    : `【${first.name}】将于 ${first.expiration} 到期，可安排食谱或标记已处理。`;
  return { first, days, priority, title, body };
}
