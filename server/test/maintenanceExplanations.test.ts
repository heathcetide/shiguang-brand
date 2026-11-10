import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceExplanations } from "../src/modules/planMaintenance/explanations.js";
import type { MaintenanceInputSnapshot } from "../src/modules/planMaintenance/inputSnapshot.js";
import type { LocalMealAssessment } from "../src/modules/planMaintenance/recalculate.js";
const snapshot: MaintenanceInputSnapshot = { fingerprint: "input",recipeIds: [],data: {
  meal_plans: [{ id: "plan",user_id: 1,constraints_json: { currentCookingDraft: { meals: [{ id: "prepared-target",date: "2026-09-13",mealType: "lunch" }] } } }],
  meal_plan_items: [{ id: "a",user_id: 1,plan_id: "plan",planned_date: "2026-09-12",meal_type: "晚餐",title: "蒸蛋" },
    { id: "foreign",user_id: 2,plan_id: "plan",title: "其他人的安排" }],recipes: [],
} };
const assessment: LocalMealAssessment = { itemId: "a",planId: "plan",date: "2026-09-12",decision: "apply",status: "missing",
  requirements: [{ foodName: "鸡蛋",required: 3,covered: 1,missing: 2,unit: "piece",uncertain: false }] };
test("captured meal labels and known ingredient shortages explain affected arrangements", () => {
  const result = maintenanceExplanations(1,snapshot,[assessment],[],["餐次 a 暂无替换", "餐次 prepared-target 的待吃分配已变化"]);
  assert.deepEqual(result,["2026-09-12 晚餐「蒸蛋」 暂无替换","2026-09-13 午餐 的待吃分配已变化","2026-09-12 晚餐「蒸蛋」：原安排鸡蛋缺 2个，需补充原料或确认替换"]);
});
test("resolved replacements omit stale shortages, while suggestions retain the original need", () => {
  const changes = [{ planVersion: 1,planId: "plan",itemId: "a",input: { version: 1,recipeId: 2 },reason: "替换" }];
  assert.deepEqual(maintenanceExplanations(1,snapshot,[assessment],changes,[]),[]);
  assert.equal(maintenanceExplanations(1,snapshot,[{ ...assessment,decision: "suggest" }],changes,[]).length,1);
});
test("unknown quantities never become numeric shortages and foreign labels are excluded", () => {
  const result = maintenanceExplanations(1,snapshot,[{ ...assessment,status: "unknown",requirements: [{ ...assessment.requirements[0],uncertain: true }] }],[],["餐次 foreign 缺少信息"]);
  assert.equal(result[0],"相关餐次 缺少信息");
  assert.ok(result[1].includes("尚不能确定")); assert.ok(!result.join("").includes("2个"));
  assert.ok(!result.join("").includes("其他人的"));
});
