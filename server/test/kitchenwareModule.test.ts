import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { KitchenwareError } from "../src/modules/kitchenware/errors.js";
import type { KitchenwareRepository } from "../src/modules/kitchenware/repository.js";
import { KitchenwareService } from "../src/modules/kitchenware/service.js";

function repository(overrides: Partial<KitchenwareRepository> = {}) {
  return {
    listCatalog: async () => [{ id: 1, name: "平底锅", category: "烹饪锅具", aliases: ["不粘锅"], attributes_json: { coating: true } }, { id: 2,name: "空气炸锅",aliases: [] }, { id: 3,name: "烤箱",aliases: [] }],
    capabilitiesForCatalog: async () => [{ code: "fry", name: "煎炒", safety_level: "normal", constraints_json: {} }],
    substitutionsForCatalog: async () => [],
    recipeAvailable: async () => false,
    ...overrides,
  } as KitchenwareRepository;
}

describe("kitchenware module", () => {
  test("resolves JSONB catalog aliases without a database-driver dependency", async () => {
    const service = new KitchenwareService(repository());
    const catalog = await service.catalog("不粘锅");
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.name, "平底锅");
    assert.deepEqual(catalog[0]?.attributes, { coating: true });
    assert.equal(catalog[0]?.capabilities[0]?.code, "fry");
  });

  test("keeps recipe availability errors stable", async () => {
    const service = new KitchenwareService(repository());
    await assert.rejects(service.compatibility(7, 99), (error: unknown) => {
      assert(error instanceof KitchenwareError);
      assert.equal(error.status, 404);
      assert.equal(error.message, "菜谱不存在");
      return true;
    });
  });

  test("conditional substitutions remain suggestions until their conditions are verified", async () => {
    const service = new KitchenwareService(repository({
      recipeAvailable: async () => true,
      requirementsForRecipe: async () => [{ role: "required", catalog_id: 2, catalog_name: "空气炸锅", confidence: 1, notes: "" }],
      ownedItems: async () => [{ id: 4, name: "烤箱", catalog_id: 3 }],
      substitutionFor: async () => ({ name: "烤箱", relation_type: "conditional", impact_json: { time: "延长" }, safety_note: "检查温度" }),
    }));
    const result = await service.compatibility(7, 99);
    assert.equal(result.blocking.length, 1);
    assert.equal(result.requirements[0]?.substitution?.name, "烤箱");
    assert.equal(result.requirements[0]?.substitution?.safetyNote, "检查温度");
  });

  test("partial names are reviewed without assigning ownership of the suggested catalog device", async () => {
    const reviews: unknown[] = []; const saved: Record<string,unknown>[] = [];
    const service = new KitchenwareService(repository({
      upsertMappingReview: async input => { reviews.push(input); },
      createItem: async (_userId,input) => { saved.push(input); return input; },
      findOwnedItem: async () => ({ id: 4 }),
      updateItem: async (_userId,_id,input) => { saved.push(input); return input; },
      requirementsForRecipe: async () => [{ role: "required",catalog_id: 1,catalog_name: "平底锅",confidence: 1 }],
      ownedItems: async () => [{ id: 4,name: "迷你平底锅玩具",catalog_id: null }],
    }));
    await service.create(7,{ name: "迷你平底锅玩具" });
    await service.update(7,4,{ name: "迷你平底锅玩具" });
    assert.equal(reviews.length,2);
    assert(saved.every(item => item.catalogId === null && item.name === "迷你平底锅玩具"));
    assert.equal((await service.evaluateRequirements(7,99)).blocking.length,1);
    await service.create(7,{ name: "不粘锅" });
    assert.equal(saved[2].catalogId,1);
    assert.equal(saved[2].name,"平底锅");
    assert.equal(reviews.length,2);
  });
  test("a shared capability cannot bypass a prohibited or conditional equipment substitution", async () => {
    for (const relation of ["forbidden","conditional","equivalent"]) {
      const service = new KitchenwareService(repository({
        requirementsForRecipe: async () => [{ role: "required",catalog_id: 1,capability_code: "fry",confidence: 1 }],
        ownedItems: async () => [{ id: 7,name: "替代设备",catalog_id: 2 }],
        substitutionsForCatalog: async () => [{ id: 2,relation_type: relation }],
        substitutionFor: async () => relation === "forbidden" ? null : { name: "替代设备",relation_type: relation },
      }));
      const result = await service.evaluateRequirements(1,99);
      assert.equal(result.blocking.length,relation === "equivalent" ? 0 : 1,relation);
    }
  });
  test("named equipment does not silently become a generic capability requirement", async () => {
    let catalogId: number | null = 1;
    const service = new KitchenwareService(repository({
      requirementsForRecipe: async () => [{ role: "required",catalog_id: catalogId,capability_code: "boil",confidence: 1 }],
      ownedItems: async () => [{ id: 7,name: "其他煮炖设备",catalog_id: 2 }],
      capabilitiesForCatalog: async () => [{ code: "boil", safety_level: "normal", constraints_json: {} }],
      substitutionFor: async () => null,
    }));
    assert.equal((await service.evaluateRequirements(1,99)).blocking.length,1);
    catalogId = null;
    assert.equal((await service.evaluateRequirements(1,99)).blocking.length,0);
  });
});

test("capability conditions require one verified device and reject malformed or restricted rules", async () => {
  let attributes: Record<string,unknown>[] = [{ capacityMl: 3000 }, { diameterCm: 28,heatSources: ["induction"] }];
  let constraints: unknown = { minCapacityMl: 3000,minDiameterCm: 28,heatSource: "induction" };
  let safety = "normal";
  const service = new KitchenwareService(repository({
    requirementsForRecipe: async () => [{ role: "required",catalog_id: null,capability_code: "fry",confidence: 1 }],
    ownedItems: async () => attributes.map((value,index) => ({ id: index+1,name: "平底锅",catalog_id: 1,attributes_json: value })),
    capabilitiesForCatalog: async () => [{ code: "fry",safety_level: safety,constraints_json: constraints }],
  }));
  const blocked = async () => (await service.evaluateRequirements(1,99)).blocking.length;
  assert.equal(await blocked(),1,"cannot pool specifications across two devices");
  attributes = [{ capacityMl: 3000,diameterCm: 28,heatSources: ["induction"] }];
  assert.equal(await blocked(),0,"inclusive boundary passes");
  attributes[0].capacityMl = 2999;
  assert.equal(await blocked(),1);
  attributes[0].capacityMl = 3000;
  attributes[0].heatSources = null;
  assert.equal(await blocked(),1,"unknown heat source does not pass");
  attributes[0].heatSources = ["gas"];
  assert.equal(await blocked(),1,"incompatible heat source does not pass");
  attributes[0].heatSources = ["induction"];
  for (const invalid of ["broken-json",null,[],{ unsupportedCondition: true },{ minCapacityMl: -1 }]) {
    constraints = invalid;
    assert.equal(await blocked(),1);
  }
  constraints = { requiredFunctions: ["temperature_control", "convection"] };
  attributes = [{ functions: ["temperature_control"] }, { functions: ["convection"] }];
  assert.equal(await blocked(),1,"functions cannot be pooled across devices");
  attributes = [{ functions: ["temperature_control", "convection"] }];
  assert.equal(await blocked(),0);
  attributes = [{ capacityMl: 3000 }];
  assert.equal(await blocked(),1,"unknown appliance functions are not assumed");
  constraints = JSON.stringify({ minCapacityMl: 3000 });
  assert.equal(await blocked(),0,"SQLite JSON text is supported");
  safety = "restricted";
  assert.equal(await blocked(),1);
  safety = "unrecognized";
  assert.equal(await blocked(),1);
  safety = "caution";
  constraints = {};
  attributes = [{}];
  assert.equal(await blocked(),0,"unconditional capabilities retain existing behavior");
});
