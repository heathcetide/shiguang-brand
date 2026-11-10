import { normalizeInventoryScanItems } from "@dietdigidose/contracts/inventory-scan";
import type { DetectedFood } from "./types";

export const MAX_AI_IMAGE_BASE64_LENGTH = 7_500_000;

export function inferFoodCategory(name: string) {
  if (/[牛猪鸡羊鱼虾蟹贝肉]|培根|火腿/.test(name)) return "肉食";
  if (/奶|芝士|黄油/.test(name)) return "乳制品";
  if (/苹果|香蕉|[橙柚梨桃]|葡萄|草莓|蓝莓|西瓜/.test(name)) return "水果";
  if (/[酱油醋盐糖米面粉豆]|罐头|披萨|泡芙/.test(name)) return "粮油干货";
  return "蔬菜";
}

export function normalizeDetectedFoods(items: unknown, sourceReference = String(Date.now())): DetectedFood[] {
  return normalizeInventoryScanItems(items).map((item, index) => ({ ...item, id: `${sourceReference}:${index}`,
    selected: true, source: "image" as const }));
}

export function mergeDetectedFoods(items: DetectedFood[]) {
  // Only a stable recognition identity is sufficient evidence of a repeated item.
  // Names may refer to separate packages, purchases, or overlapping photographs.
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  const counts = new Map<string, number>();
  for (const item of unique) {
    const name = item.foodName.trim().toLocaleLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return unique.map(item => (counts.get(item.foodName.trim().toLocaleLowerCase()) ?? 0) > 1
    ? { ...item, missingFields: [...new Set([...(item.missingFields ?? []), "是否为独立批次"])] }
    : item);
}
