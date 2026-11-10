import { parseDateKey, toLocalDateKey } from "./date";

export type InventoryFreshness = "used_up" | "expired" | "urgent" | "expiring" | "warning" | "fresh" | "invalid";

export type InventoryStatus = {
  freshness: InventoryFreshness;
  daysRemaining: number | null;
};

export const daysUntilDateKey = (expirationDate: string, today = new Date()): number | null => {
  const expiration = parseDateKey(expirationDate);
  const todayDate = parseDateKey(toLocalDateKey(today));
  if (!expiration || !todayDate) return null;
  const expirationUtc = Date.UTC(expiration.getFullYear(), expiration.getMonth(), expiration.getDate());
  const todayUtc = Date.UTC(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
  return Math.round((expirationUtc - todayUtc) / 86_400_000);
};

export const getInventoryStatus = (
  item: { expiration_date: string; is_available: boolean },
  today = new Date()
): InventoryStatus => {
  if (!item.is_available) return { freshness: "used_up", daysRemaining: null };
  const daysRemaining = daysUntilDateKey(item.expiration_date, today);
  if (daysRemaining === null) return { freshness: "invalid", daysRemaining: null };
  if (daysRemaining < 0) return { freshness: "expired", daysRemaining };
  if (daysRemaining <= 2) return { freshness: "urgent", daysRemaining };
  if (daysRemaining <= 3) return { freshness: "expiring", daysRemaining };
  if (daysRemaining <= 5) return { freshness: "warning", daysRemaining };
  return { freshness: "fresh", daysRemaining };
};

export interface BadgeConfig {
  label: string;
  badgeBg: string;
  textColor: string;
  level: number;
}

export function getExpirationBadgeConfig(status: InventoryStatus): BadgeConfig {
  const { freshness, daysRemaining } = status;
  if (freshness === "expired") {
    return { label: "已过期", badgeBg: "bg-red-500/15", textColor: "text-rose-700", level: 1 };
  }
  if (freshness === "urgent") {
    const label = daysRemaining === 0 ? "今天到期" : `剩${daysRemaining}天紧急`;
    return { label, badgeBg: "bg-amber-500/15", textColor: "text-amber-800", level: 2 };
  }
  if (freshness === "expiring" || freshness === "warning") {
    return { label: `剩${daysRemaining}天关注`, badgeBg: "bg-yellow-500/15", textColor: "text-amber-700", level: 3 };
  }
  if (freshness === "fresh") {
    return { label: `剩${daysRemaining}天`, badgeBg: "bg-emerald-500/15", textColor: "text-brand", level: 4 };
  }
  if (freshness === "used_up") {
    return { label: "已用完", badgeBg: "bg-gray-200", textColor: "text-gray-500", level: 5 };
  }
  return { label: "日期未知", badgeBg: "bg-gray-100", textColor: "text-gray-400", level: 5 };
}

// Display classification only: never replace the original stored location.
export type InventoryStorageDisplay = "冷藏" | "冷冻" | "常温" | "位置待确认";

export function getInventoryStorageDisplay(location: string | null | undefined): InventoryStorageDisplay {
  return location === "冷藏" || location === "冷冻" || location === "常温" ? location : "位置待确认";
}

export function groupInventoryByStorage<T extends { storage_location?: string | null }>(items: T[]) {
  const groups: Record<InventoryStorageDisplay, T[]> = { 冷藏: [], 冷冻: [], 常温: [], 位置待确认: [] };
  for (const item of items) groups[getInventoryStorageDisplay(item.storage_location)].push(item);
  return groups;
}

export function formatInventoryQuantity(quantity: string | null | undefined): string {
  return quantity?.trim() || "数量未知";
}
