import type { AgentActionProposal } from "./types";

export type ApprovalField = { key: string; label: string; numeric?: boolean };

const qtyFields: ApprovalField[] = [{ key: "quantityValue", label: "数量", numeric: true }, { key: "quantityUnit", label: "单位" }];
const planFields: ApprovalField[] = [{ key: "title", label: "计划标题" }, { key: "startDate", label: "开始日期" }, { key: "endDate", label: "结束日期" }];

const fields: Record<string, ApprovalField[]> = {
  add_inventory_item: [{ key: "name", label: "食材名称" }, ...qtyFields, { key: "expirationDate", label: "到期日期" }],
  update_inventory_item: qtyFields,
  record_diet_meal: [{ key: "foodName", label: "食物名称" }, { key: "amount", label: "食用量" }, { key: "mealType", label: "餐次" }, { key: "recordedAt", label: "日期" }, { key: "calories", label: "热量(kcal)", numeric: true }, { key: "protein", label: "蛋白质(g)", numeric: true }, { key: "carbs", label: "碳水(g)", numeric: true }, { key: "fat", label: "脂肪(g)", numeric: true }],
  record_health_log: [{ key: "weightKg", label: "体重(kg)", numeric: true }, { key: "bodyFatPercentage", label: "体脂率(%)", numeric: true }, { key: "waterMl", label: "饮水(ml)", numeric: true }],
  add_kitchenware_item: [{ key: "name", label: "厨具名称" }, { key: "category", label: "类别" }],
  submit_recipe: [{ key: "title", label: "菜谱标题" }, { key: "cookTime", label: "烹饪用时(分)", numeric: true }],
  update_shopping_item: [{ key: "name", label: "清单项" }, { key: "amount", label: "数量及单位" }],
  create_meal_plan: planFields,
  update_meal_plan: planFields,
};

export const approvalFields = (action: AgentActionProposal): ApprovalField[] => fields[action.actionType] || [];
export const isEditableAction = (action: AgentActionProposal): boolean => Boolean(fields[action.actionType]?.length);
export const getActionScopeDescription = (action: AgentActionProposal): string => action.actionType.includes("preference") ? "影响长期偏好" : "仅本次业务操作";

export function editApprovalField(action: AgentActionProposal, field: ApprovalField, value: string): AgentActionProposal {
  let parsedValue: unknown = value;
  if (field.numeric) {
    if (!value.trim()) parsedValue = undefined;
    else {
      const num = Number(value);
      parsedValue = Number.isFinite(num) ? num : action.payload[field.key];
    }
  }
  const payload = { ...action.payload };
  if (parsedValue === undefined) delete payload[field.key];
  else payload[field.key] = parsedValue;
  return { ...action, payload };
}
