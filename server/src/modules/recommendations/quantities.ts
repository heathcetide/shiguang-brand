import { QuantityDecimal, QuantityPrecisionError } from "@dietdigidose/contracts/quantity-decimal";
import type { InventoryUnit } from "../../services/inventoryQuantity.js";
type Demand = { food_name: string; amount_value: number; unit: InventoryUnit };
const units: Record<string, InventoryUnit> = { g: "g", 克: "g", kg: "kg", 千克: "kg", 公斤: "kg", ml: "ml", 毫升: "ml", l: "l", 升: "l", 个: "piece", 枚: "piece", 只: "piece", 份: "serving", 袋: "bag", 盒: "box", 瓶: "bottle", 罐: "can" };
export function recipeDemands(ingredients: Array<{ name: string; amount: string }>, yieldSize: number | null, portions: number): Demand[] | null {
  if (!yieldSize || !Number.isFinite(yieldSize) || yieldSize <= 0 || !Number.isFinite(portions) || portions <= 0 || !ingredients.length) return null;
  const result: Demand[] = [];
  for (const ingredient of ingredients) {
    const match = ingredient.amount.match(/^(\d+(?:\.\d+)?)\s*(kg|千克|公斤|ml|毫升|g|克|l|升|个|枚|只|份|袋|盒|瓶|罐)$/i);
    if (!match || Number(match[1]) <= 0) return null;
    try {
      const amount = QuantityDecimal.from(Number(match[1])).multiply(QuantityDecimal.from(portions))
        .divide(QuantityDecimal.from(yieldSize)).toNumber();
      result.push({ food_name: ingredient.name, amount_value: amount, unit: units[match[2].toLowerCase()] });
    } catch (error) {
      // Do not introduce binary multiplication noise or invent a rounded portion.
      if (error instanceof QuantityPrecisionError) return null;
      throw error;
    }
  }
  return result;
}

