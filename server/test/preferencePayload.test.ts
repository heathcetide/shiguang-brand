import assert from "node:assert/strict";
import test from "node:test";
import { hasPermanentPreferenceIntent, permanentPreferencePayloadSchema } from "../src/services/agent/preferencePayload.js";
import { validateAgentActions } from "../src/services/agent/policy.js";

test("persistent preferences require explicit durable intent and remain high risk", () => {
  for (const text of ["今天两个人，做今晚和明天午饭", "这次不要冷藏", "今天两个人，以后再说", "不要保存默认偏好"]) {
    assert.equal(hasPermanentPreferenceIntent(text), false, text);
  }
  assert.equal(hasPermanentPreferenceIntent("以后都按两个人"), true);
  assert.equal(hasPermanentPreferenceIntent("记住我在单位不能加热"), true);
  assert.equal(permanentPreferencePayloadSchema.safeParse({ scope: "persistent", preferences: { allergies: [] } }).success, false);
  assert.equal(permanentPreferencePayloadSchema.safeParse({ scope: "request", preferences: { servings: 2 } }).success, false);
  const actions = validateAgentActions([{ actionType: "update_kitchen_preferences", summary: "长期人数改为两人",
    payload: { scope: "persistent", preferences: { servings: 2 } } }], {
    userId: 1, dailyCaloriesTarget: 2000, inventory: [], kitchenware: [], todayDiet: [], recommendedRecipes: [],
  });
  assert.equal(actions[0].riskLevel, "high");
});

test("negated, quoted and interrogative permanent language cannot turn temporary choices into saved preferences",() => {
  for (const text of ["不是长期，只是今天两个人", "我没有要求你记住这个设置", "不需要保存为默认", "今天不吃辣，不是默认设置", "要不要记住我在单位不能加热？", "以后都按两个人吗", "你说默认两个人，但今天只有一个", "比如‘以后都按两个人’是什么意思？", "例如以后都按两个人", "请解释“记住我的习惯”", "本次不用保存长期偏好", "只针对今天默认两个人"]) assert.equal(hasPermanentPreferenceIntent(text),false,text);
  for (const text of ["今天两个人。以后默认一个人。", "请记住我平时在家吃晚饭", "今后都按两个人", "我通常不能在单位加热"]) assert.equal(hasPermanentPreferenceIntent(text),true,text);
});


test("recipe taste writes are explicit persistent versioned high-risk proposals",() => {
  const context = { userId: 1,dailyCaloriesTarget: 2000,inventory: [],kitchenware: [],todayDiet: [],recommendedRecipes: [] };
  const proposal = { actionType: "update_recipe_preference",summary: "长期不喜欢此菜",payload: { scope: "persistent",recipeId: 1,version: 2,value: "dislike" } };
  assert.equal(validateAgentActions([proposal],context)[0].riskLevel,"high");
  for (const patch of [{ scope: "session" },{ version: undefined },{ allergies: [] },{ value: "like" }])
    assert.throws(() => validateAgentActions([{ ...proposal,payload: { ...proposal.payload,...patch } }],context));
});
