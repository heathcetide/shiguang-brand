import assert from "node:assert/strict";
import { test } from "node:test";
import { interventionDates, interventionDinnerState, interventionRecommendations } from "../src/modules/interventions/snapshot.js";

test("dinner snapshot uses the user's date, queue state, opt-out, and active plans", () => {
  const dates = interventionDates(Date.parse("2026-09-12T16:30:00Z"),"America/Los_Angeles");
  assert.deepEqual(dates,["2026-09-12","2026-09-13"]);
  const state = interventionDinnerState(dates,"Asia/Shanghai",[{ planned_date: dates[0],meal_type: "晚餐",status: "planned" }],[],[],dates[1]);
  assert.deepEqual(state,{ cookingInProgress: false,dinnerDays: [
    { localDate: dates[0],alreadyPlanned: true,notCooking: false },{ localDate: dates[1],alreadyPlanned: false,notCooking: true },
  ] });
  const preparedOnly = { status: "requires_validation",meals: [{ id: "dinner",date: dates[0],mealType: "dinner",servings: 1,preparedServings: 1,cookServings: 0,
    allocations: [{ preparedMealId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",version: 1,foodName: "备餐",servings: 1,validationRequired: true }] }],
    totalCookServings: 0,cooking: [],unresolved: [],ingredientBudget: [],time: { budgetMinutes: 30,knownSequentialMinutes: 0,exceedsBudget: false,isEstimate: true,incomplete: false,missing: [] },
    checksPending: [],excludedPreparedMealIds: [],effectivePreferences: {} };
  assert.deepEqual(interventionDinnerState(dates,"Asia/Shanghai",[],[{ constraints_json: { currentCookingDraft: preparedOnly } }],[],null).dinnerDays.map(row => row.alreadyPlanned),[true,false]);
  const queued = interventionDinnerState(dates,"Asia/Shanghai",[],[],[{ status: "waiting",planned_at: "2026-09-12T16:30:00Z" }],null);
  assert.deepEqual(queued.dinnerDays.map(row => row.alreadyPlanned),[false,true]);
  assert.equal(interventionDinnerState(dates,"Asia/Shanghai",[],[],[{ status: "cooking" }],null).cookingInProgress,true);
  assert(interventionDinnerState(dates,"Asia/Shanghai",[],[{ constraints_json: { currentCookingDraft: { malformed: true } } }],[],null).dinnerDays.every(row => row.alreadyPlanned));
  assert(interventionDinnerState(dates,"Asia/Shanghai",[],[],[{ status: "waiting",deleted_at: "deleted" }],null).dinnerDays.every(row => !row.alreadyPlanned));
});

test("recommendation adapter requires hard constraints and known sufficient inventory", () => {
  type Result = Parameters<typeof interventionRecommendations>[0][number];
  const result = { recipeId: 7,score: 72,hardConstraints: { unmet: [],satisfied: ["quality","permission","allergy","time","kitchenware"] },
    recipe: { ingredients: [{ name: "番茄" }] },features: { uncertainIngredients: [],missingIngredients: [],inventoryEvidence: { allocations: [{ itemId: 3,amount: 2 },{ itemId: 3,amount: 1 }] } } } as unknown as Result;
  assert.deepEqual(interventionRecommendations([result]),[{ recipeId: 7,quality: 0.8,hardConstraintsPassed: true,inventoryIds: [3] }]);
  assert.deepEqual(interventionRecommendations([{ ...result,hardConstraints: { ...result.hardConstraints,unmet: ["allergy"] } }]),[]);
  assert.deepEqual(interventionRecommendations([{ ...result,features: { ...result.features,uncertainIngredients: [{ name: "番茄",amount: "未知" }] } }]),[]);
});
