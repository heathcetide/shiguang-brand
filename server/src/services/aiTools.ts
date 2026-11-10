import type { AiToolDataService } from "../modules/aiToolData/service.js";
import { aiWriteConfirmationsService } from "../modules/aiWriteConfirmations/runtime.js";
import { currentDateKey, currentTimeKey } from "../utils/date.js";

let configuredDataService: AiToolDataService | undefined;

export function configureAiToolDataService(service: AiToolDataService) { configuredDataService = service; }

function dataService() {
  if (!configuredDataService) throw new Error("AI tool data service has not been configured");
  return configuredDataService;
}

export function isAIQueryTool(name: string) { return name === "search_recipe_library" || name === "lookup_food_nutrition"; }

export async function executeAIQueryTool(userId: number, toolName: string, args: Record<string, unknown>) {
  if (toolName === "search_recipe_library") {
    const names = Array.isArray(args.ingredientNames) ? args.ingredientNames.map(String).filter(Boolean).slice(0, 8) : [];
    const limit = Math.max(1, Math.min(Number(args.limit) || 5, 10));
    return dataService().searchRecipes({ ingredientNames: names, limit,
      maxTimeMinutes: Number.isFinite(Number(args.maxTimeMinutes)) ? Math.max(0, Number(args.maxTimeMinutes)) : undefined,
      maxCalories: Number.isFinite(Number(args.maxCalories)) ? Math.max(0, Number(args.maxCalories)) : undefined,
      minProteinG: Number.isFinite(Number(args.minProteinG)) ? Math.max(0, Number(args.minProteinG)) : undefined });
  }
  if (toolName === "lookup_food_nutrition") {
    const foodName = String(args.foodName || "").trim(); const amount = Math.max(0, Number(args.amount) || 0); const unit = String(args.unit || "g");
    if (!foodName || !amount) return { matches: [], warnings: ["缺少有效食品名称或数量"] };
    return dataService().lookupFoodNutrition(foodName, amount, unit);
  }
  return { error: "未知查询工具" };
}
/**
 * 执行 AI Function Tool 调用；持久化由已配置的数据适配器负责
 */
export async function executeAITool(
  userId: number,
  toolName: string,
  args: any
): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const todayStr = currentDateKey();

    if (toolName === "record_diet_meal") {
      const mealType = args.mealType || "午餐";
      const foodName = args.foodName || "健康料理";
      const amount = args.amount || "1份";
      const calories = args.calories ?? 300;
      const protein = args.protein ?? 18;
      const carbs = args.carbs ?? 35;
      const fat = args.fat ?? 8;

      const id = await dataService().recordDietMeal({ userId, mealType, foodName, amount, calories, protein, carbs, fat,
        recordedAt: todayStr, recordedTime: currentTimeKey() });

      return {
        success: true,
        message: `✅ 已成功为你完成【${mealType}】打卡：${foodName} (${amount}, 约 ${calories} kcal)!`,
        details: { id, mealType, foodName, calories },
      };
    }

    if (toolName === "add_inventory_item") {
      const name = args.name;
      const category = args.category || "其它";
      const location = args.location || "保鲜库";
      const quantity = args.quantity || "1份";
      const expireDays = args.expireDays ?? 7;

      const preview = await aiWriteConfirmationsService().createPreview({ userId, action: "add_inventory_item", payload: {
        name, category, location: location === "保鲜库" ? "冷藏" : location === "冷冻库" ? "冷冻" : "常温", quantity, expireDays,
      } });

      return {
        success: true,
        message: `已为食材【${name}】生成入库确认，请核对后提交。`,
        details: { writeConfirmation: preview },
      };
    }

    if (toolName === "add_kitchenware_item") {
      const name = String(args.name || "").trim();
      const allowedCategories = new Set(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]);
      const allowedStatuses = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);
      if (!name) return { success: false, message: "请提供厨具名称" };
      const category = allowedCategories.has(args.category) ? args.category : "其他";
      const status = allowedStatuses.has(args.status) ? args.status : "良好";
      const note = String(args.note || "").trim().slice(0, 300);

      const preview = await aiWriteConfirmationsService().createPreview({ userId, action: "add_kitchenware_item", payload: { name, category, status, note } });

      return {
        success: true,
        message: `已为厨具【${name}】生成入库确认，请核对后提交。`,
        details: { writeConfirmation: preview },
      };
    }

    if (toolName === "record_health_log") {
      const weight = args.weightKg ?? null;
      const bodyFat = args.bodyFatPercentage ?? null;
      const waterMl = args.waterMl ?? null;

      const preview = await aiWriteConfirmationsService().createPreview({ userId, action: "record_health_log", payload: { weightKg: weight, bodyFatPercentage: bodyFat, waterMl } });

      return {
        success: true,
        message: "已生成健康数据确认，请核对后提交。",
        details: { writeConfirmation: preview },
      };
    }

    return { success: false, message: `未知的工具名称: ${toolName}` };
  } catch (err: any) {
    console.error(`[AI Tool Execution Error] ${toolName}:`, err);
    console.error("[AI Tool Execution Error]", err instanceof Error ? err.message : err);
    return { success: false, message: "执行工具失败，请稍后重试" };
  }
}
