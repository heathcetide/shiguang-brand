export type StructuredUnit = "g" | "kg" | "ml" | "l" | "piece" | "serving" | "bag" | "box" | "bottle" | "can";

const UNIT_ALIASES: Record<string, StructuredUnit> = {
  g: "g", 克: "g",
  kg: "kg", 千克: "kg", 公斤: "kg",
  ml: "ml", 毫升: "ml",
  l: "l", 升: "l",
  个: "piece", 枚: "piece", 只: "piece", 片: "piece",
  份: "serving", 袋: "bag", 盒: "box", 瓶: "bottle", 罐: "can",
};

export function parseStructuredQuantity(value?: string | null) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)\s*(kg|千克|公斤|ml|毫升|[gl克升个枚只片份袋盒瓶罐])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = UNIT_ALIASES[match[2].toLocaleLowerCase()] || UNIT_ALIASES[match[2]];
  return Number.isFinite(amount) && amount > 0 && unit ? { amount, unit } : null;
}

export function structuredUnitLabel(unit: StructuredUnit) {
  return ({ g: "g", kg: "kg", ml: "ml", l: "L", piece: "个", serving: "份", bag: "袋", box: "盒", bottle: "瓶", can: "罐" } as const)[unit];
}
