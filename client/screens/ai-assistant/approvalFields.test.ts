import {
  approvalFields,
  isEditableAction,
  getActionScopeDescription,
  editApprovalField,
  type ApprovalField,
} from "./approvalFields";
import type { AgentActionProposal } from "./types";

describe("approvalFields", () => {
  test("returns correct approval fields for supported action types", () => {
    const dietMealAction: AgentActionProposal = {
      actionType: "record_diet_meal",
      riskLevel: "low",
      summary: "记录午餐鸡胸肉沙拉",
      payload: { foodName: "鸡胸肉沙拉", amount: "200g", mealType: "lunch" },
    };
    const fields = approvalFields(dietMealAction);
    expect(fields.map((f) => f.key)).toEqual([
      "foodName",
      "amount",
      "mealType",
      "recordedAt",
      "calories",
      "protein",
      "carbs",
      "fat",
    ]);

    const kitchenwareAction: AgentActionProposal = {
      actionType: "add_kitchenware_item",
      riskLevel: "low",
      summary: "添加平底锅",
      payload: { name: "不粘平底锅", category: "锅具" },
    };
    expect(approvalFields(kitchenwareAction).map((f) => f.key)).toEqual(["name", "category"]);

    const shoppingAction: AgentActionProposal = {
      actionType: "update_shopping_item",
      riskLevel: "low",
      summary: "修改西红柿采购项",
      payload: { name: "西红柿", amount: "2个" },
    };
    expect(approvalFields(shoppingAction).map((f) => f.key)).toEqual(["name", "amount"]);
  });

  test("returns empty array for unsupported or non-configurable action types", () => {
    const unknownAction: AgentActionProposal = {
      actionType: "unknown_future_action",
      riskLevel: "forbidden",
      summary: "未知动作",
      payload: {},
    };
    expect(approvalFields(unknownAction)).toEqual([]);
    expect(isEditableAction(unknownAction)).toBe(false);
  });

  test("isEditableAction identifies editable actions", () => {
    const editable: AgentActionProposal = {
      actionType: "add_inventory_item",
      riskLevel: "low",
      summary: "添加鸡蛋",
      payload: { name: "鸡蛋" },
    };
    expect(isEditableAction(editable)).toBe(true);
  });

  test("getActionScopeDescription distinguishes permanent preference from one-off operation", () => {
    const oneOff: AgentActionProposal = {
      actionType: "add_inventory_item",
      riskLevel: "low",
      summary: "添加食材",
      payload: {},
    };
    expect(getActionScopeDescription(oneOff)).toBe("仅本次业务操作");

    const permanent: AgentActionProposal = {
      actionType: "update_recipe_preference",
      riskLevel: "high",
      summary: "偏好更新",
      payload: {},
    };
    expect(getActionScopeDescription(permanent)).toBe("影响长期偏好");
  });

  describe("editApprovalField", () => {
    test("updates string field properly", () => {
      const action: AgentActionProposal = {
        actionType: "record_diet_meal",
        riskLevel: "low",
        summary: "记录饮食",
        payload: { foodName: "苹果", amount: "1个" },
      };
      const field: ApprovalField = { key: "foodName", label: "食物名称" };
      const updated = editApprovalField(action, field, "红富士苹果");
      expect(updated.payload.foodName).toBe("红富士苹果");
      expect(updated.payload.amount).toBe("1个");
    });

    test("converts numeric field properly", () => {
      const action: AgentActionProposal = {
        actionType: "record_health_log",
        riskLevel: "low",
        summary: "记录体重",
        payload: { weightKg: 65 },
      };
      const field: ApprovalField = { key: "weightKg", label: "体重", numeric: true };
      const updated = editApprovalField(action, field, "68.5");
      expect(updated.payload.weightKg).toBe(68.5);
    });

    test("deletes/unsets key when numeric field is cleared", () => {
      const action: AgentActionProposal = {
        actionType: "record_health_log",
        riskLevel: "low",
        summary: "记录饮水",
        payload: { waterMl: 500 },
      };
      const field: ApprovalField = { key: "waterMl", label: "饮水量", numeric: true };
      const updated = editApprovalField(action, field, "   ");
      expect(updated.payload.waterMl).toBeUndefined();
      expect("waterMl" in updated.payload).toBe(false);
    });

    test("preserves existing value if numeric input is invalid NaN", () => {
      const action: AgentActionProposal = {
        actionType: "record_health_log",
        riskLevel: "low",
        summary: "记录饮水",
        payload: { waterMl: 500 },
      };
      const field: ApprovalField = { key: "waterMl", label: "饮水量", numeric: true };
      const updated = editApprovalField(action, field, "abc");
      expect(updated.payload.waterMl).toBe(500);
    });
  });
});
