import { prepareDiningShopping } from "../src/modules/households/diningShopping.js";
import { checkDiningRecipe } from "../src/modules/households/recipeConstraints.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HouseholdsRepository } from "../src/modules/households/repository.js";
import { HouseholdsService } from "../src/modules/households/service.js";

function repository(overrides: Partial<HouseholdsRepository> = {}): HouseholdsRepository {
  return {
    diningSupply: async () => ({ status: "needs_review",otherMealCount: 0,demands: [],checks: [] }),diningPlanContext: async () => null,reserveMeal: async () => ({}),meals: async () => [],eatMeal: async () => ({}),produceMeal: async () => ({}), diningRecipe: async () => null, diningMembers: async () => [], diningPreferences: async () => null,saveDiningPreferences: async () => false,
    create: async () => ({}), mine: async () => [], join: async () => ({ kind: "not_found" }),
    leave: async () => ({ kind: "not_member" }), transferOwner: async () => ({ kind: "not_owner" }),
    shoppingList: async () => null, createShopping: async () => ({ kind: "not_member" }),
    updateShopping: async () => ({ kind: "not_found" }), removeShopping: async () => "not_found",
    intake: async () => ({ kind: "not_member" }), inventory: async () => null,
    createInventory: async () => ({ kind: "not_member" }), updateInventory: async () => ({ kind: "not_found" }),
    removeInventory: async () => "not_found", history: async () => null, ...overrides,
  };
}

describe("households module", () => {
  test("retries invite collisions and preserves join status contracts", async () => {
    const codes: string[] = [];
    const service = new HouseholdsService(repository({
      create: async (_userId, name, code) => { codes.push(code); return codes.length === 1 ? null : { id: 9, name, invite_code: code }; },
      join: async () => ({ kind: "joined", household: { id: 9 } }),
    }), (() => { let next = 0; return () => ["COLLIDE1", "FRESH123"][next++]!; })());
    assert.equal((await service.create(7, " 家庭 ")).invite_code, "FRESH123");
    assert.deepEqual(codes, ["COLLIDE1", "FRESH123"]);
    assert.equal((await service.join(7, " fresh123 ")).status, 201);
  });

  test("formats driver-neutral shopping rows and maps optimistic conflicts", async () => {
    const row = { id: "item", household_id: "3", name: "牛奶", amount: "2盒", category: "乳制品", checked: true,
      storage_location: "冷藏", expiration_date: null, created_by_user_id: "1", updated_by_user_id: "2",
      purchased_by_user_id: "2", creator_name: "甲", updater_name: "乙", purchaser_name: "乙", version: "2",
      created_at: new Date("2030-01-01T00:00:00Z"), updated_at: "2030-01-02 00:00:00" };
    const service = new HouseholdsService(repository({
      shoppingList: async () => [row], createShopping: async () => ({ kind: "created", item: row,
        active: [{ id: "older", name: "牛奶（盒装）", amount: "1盒", category: "乳制品" }] }),
      updateShopping: async () => ({ kind: "version_conflict" }),
    }));
    const listed = await service.shoppingList(1, 3);
    assert.equal(listed[0]?.checked, true); assert.equal(listed[0]?.createdAt, "2030-01-01T00:00:00.000Z");
    assert.equal((await service.createShopping(1, 3, "item", { name: "牛奶", amount: "2盒", category: "乳制品" }))
      .mergeCandidates[0]?.id, "older");
    await assert.rejects(() => service.updateShopping(1, 3, "item", { version: 1, checked: true }), /其他成员更新/);
  });

  test("keeps repeated intake and household permissions independent of the driver", async () => {
    const service = new HouseholdsService(repository({
      intake: async () => ({ kind: "repeated", value: { batchId: "batch", inventoryIds: [4], count: 1, repeated: true } }),
      inventory: async () => [{ id: 4, is_available: 1 }], history: async () => null,
    }));
    const intake = await service.intake(1, 3, "batch", { idempotencyKey: "1234567890123456", items: [] });
    assert.equal(intake.status, 200); assert.equal(intake.body.repeated, true);
    assert.equal((await service.inventory(1, 3))[0]?.is_available, true);
    await assert.rejects(() => service.history(2, 3), /无权查看/);
  });
});

 test("three diners retain individual portions and every selected hard constraint", async () => {
  const rows = [
    { id: 11,user_id: 1,name: "甲",dining_version: 2,dining_shared: 1,dining_preferences_json: { allergies: ["花生"],restrictions: [] } },
    { id: 12,user_id: 2,name: "乙",dining_version: 3,dining_shared: 1,dining_preferences_json: { allergies: ["虾"],restrictions: ["素食"] } },
    { id: 13,user_id: 3,name: "丙",dining_version: 1,dining_shared: 1,dining_preferences_json: { allergies: [],restrictions: ["不吃猪肉"] } },
  ];
  const service = new HouseholdsService(repository({ diningMembers: async () => rows }));
  const participants = rows.map(row => ({ membershipId: row.id,version: row.dining_version,servings: 1 }));
  const preview = await service.previewDiningAllocation(1,9,{ participants });
  assert.equal(preview.totalServings,3);
  assert.deepEqual(preview.participants.map(person => person.servings),[1,1,1]);
  assert.deepEqual(preview.allergies,["花生","虾"]);
  assert.deepEqual(preview.restrictions,["素食","不吃猪肉"]);
  assert.equal(preview.recipeValidationRequired,true);
  const absent = await service.previewDiningAllocation(1,9,{ participants: participants.slice(0,2) });
  assert.equal(absent.totalServings,2); assert.deepEqual(absent.restrictions,["素食"]);
  const fractions = await service.previewDiningAllocation(1,9,{ participants: participants.map((item,index) => ({ ...item,servings: [0.1,0.2,0.000001][index]! })) });
  assert.equal(fractions.totalServings,0.300001);
  await assert.rejects(() => service.previewDiningAllocation(1,9,{ participants: [participants[0]!,participants[0]!] }));
  rows[1]!.dining_shared = 0;
  await assert.rejects(() => service.previewDiningAllocation(1,9,{ participants }),/尚未授权/);
 });

test("shared recipe checks include every diner and never certify unknown restrictions", () => {
  const result = checkDiningRecipe({ id: 4,title: "家常菜",ingredients_json: [{ name: "植物油（花生油）" },{ name: "猪肉" }] },[
    { membershipId: 1,allergies: [],restrictions: [] },
    { membershipId: 2,allergies: ["花生"],restrictions: [] },
    { membershipId: 3,allergies: [],restrictions: ["不吃猪肉、虾"] },
  ]);
  assert.equal(result.status,"blocked");
  assert.deepEqual(result.conflicts.map(item => item.membershipId),[2,3]);
  const uncertain = checkDiningRecipe({ id: 5,title: "青菜",ingredients_json: [{ name: "青菜" }] },[{ membershipId: 1,allergies: [],restrictions: ["低嘌呤"] }]);
  assert.equal(uncertain.status,"needs_review");
  assert.ok(uncertain.checks.length);
});

test("shared raw ingredient demand scales once for all diners and rejects incomplete quantities", () => {
  const recipe = { id: 5,title: "蔬菜饭",serving_size: 2,ingredients_json: [{ name: "大米",amount: "200g" },{ name: "水",amount: "300ml" }] };
  const result = checkDiningRecipe(recipe,[],3);
  assert.equal(result.materials.status,"known");
  assert.deepEqual(result.materials.demands,[{ food_name: "大米",amount_value: 300,unit: "g" },{ food_name: "水",amount_value: 450,unit: "ml" }]);
  assert.equal(checkDiningRecipe({ ...recipe,serving_size: null },[],3).materials.status,"unknown");
  assert.equal(checkDiningRecipe({ ...recipe,ingredients_json: [...recipe.ingredients_json,{ name: "盐",amount: "适量" }] },[],3).materials.status,"unknown");
  assert.equal(checkDiningRecipe({ ...recipe,serving_size: Infinity },[],3).materials.status,"unknown");
  assert.equal(checkDiningRecipe({ ...recipe,ingredients_json: [{ name: "大米",amount: "0.000001g" }] },[],0.000001).materials.status,"unknown");
});


test("shared shopping derives total raw demand and refuses manually changed sources",() => {
  const dining = { householdId: 1,constraintsReviewed: true as const,participants: [1,2,3].map(id => ({ membershipId: id,version: 1,servings: 1 })) };
  const recipe = { id: 1,title: "米饭",serving_size: 1,ingredients_json: [{ name: "米",amount: "100g" }] };
  assert.deepEqual(prepareDiningShopping(dining,dining,recipe,[],checkDiningRecipe(recipe,[],3).fingerprint),[{ key: '["米","g"]',name: '米',amount: '300g' }]);
  assert.throws(() => prepareDiningShopping(dining,dining,{ ...recipe,ingredients_json: [{ name: "米",amount: "200g" }] },[],checkDiningRecipe(recipe,[],3).fingerprint),/菜谱内容已变化/);
  for (const row of [{ checked: true },{ transferred_at: '2036-09-12' },{ deleted_at: '2036-09-12' },{ version: 2 }]) {
    assert.throws(() => prepareDiningShopping(dining,dining,recipe,[{ household_id: 1,version: 1,source_generated_version: 1,...row }]),/不自动覆盖/);
  }
});
