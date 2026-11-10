import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotKitchenware } from "../src/modules/planMaintenance/snapshotKitchenware.js";
import { inputSnapshot, maintenanceRuleTables } from "../src/modules/planMaintenance/inputSnapshot.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";

function fixture() {
  const data: Record<string,Row[]> = Object.fromEntries(maintenanceRuleTables.map(name => [name,[]]));
  data.kitchenware_catalog = [
    { id: 1,name: "蒸锅",category: "锅具",quality_status: "trusted",aliases: ["蒸笼"] },
    { id: 2,name: "电饭煲",category: "电器",quality_status: "trusted",aliases: [] },
  ];
  data.kitchenware_capabilities = [{ code: "steam", safety_level: "caution" }];
  data.kitchenware_items = [{ id: 1,user_id: 1,name: "蒸笼",catalog_id: null,status: "常用" }];
  data.recipes = [{ id: 10,status: "approved" }];
  data.recipe_kitchenware_requirements = [{ id: 1,recipe_id: 10,catalog_id: 1,role: "required",confidence: 1 }];
  return data;
}

test("snapshot evaluation resolves catalog aliases without changing the snapshot", async () => {
  const snapshot = inputSnapshot(1,[10],fixture()); const before = structuredClone(snapshot);
  const result = await snapshotKitchenware(snapshot).evaluateRequirements(1,10);
  assert.equal(result.blocking.length,0); assert.equal(result.requirements[0].satisfied,true);
  assert.deepEqual(snapshot,before);
  assert.equal((await snapshotKitchenware(snapshot).evaluateRequirements(2,10)).blocking.length,1);
});

test("repair status, required capabilities and forbidden substitutions remain enforced", async () => {
  const data = fixture(); data.kitchenware_items[0].status = "维修中";
  assert.equal((await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10)).blocking.length,1);
  data.kitchenware_items = [{ id: 2,user_id: 1,name: "电饭煲",catalog_id: 2,status: "常用" }];
  data.kitchenware_substitutions = [{ source_catalog_id: 1,substitute_catalog_id: 2,relation_type: "forbidden" }];
  assert.equal((await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10)).blocking.length,1);
  data.kitchenware_substitutions[0].relation_type = "equivalent";
  assert.equal((await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10)).blocking.length,0);
  data.kitchenware_substitutions[0].relation_type = "conditional";
  data.recipe_kitchenware_requirements[0].capability_code = "steam";
  data.kitchenware_catalog_capabilities = [{ catalog_id: 2,capability_code: "steam", constraints_json: {} }];
  const conditional = await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10);
  assert.equal(conditional.blocking.length,1);
  assert.equal(conditional.requirements[0].substitution?.relationType,"conditional");
  data.kitchenware_substitutions = [];
  data.recipe_kitchenware_requirements[0].catalog_id = null;
  data.recipe_kitchenware_requirements[0].capability_code = "steam";
  data.kitchenware_catalog_capabilities = [{ catalog_id: 2,capability_code: "steam", constraints_json: {} }];
  assert.equal((await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10)).blocking.length,0);
});

test("omitted governance inputs fail closed and rule edits change the input fingerprint", () => {
  const data = fixture(); const initial = inputSnapshot(1,[10],data).fingerprint;
  data.recipe_kitchenware_requirements[0].catalog_id = 2;
  assert.notEqual(inputSnapshot(1,[10],data).fingerprint,initial);
  delete data.kitchenware_substitutions;
  assert.throws(() => snapshotKitchenware(inputSnapshot(1,[10],data)),/Missing maintenance input/);
});

test("withdrawn catalog entries cannot supply capabilities or satisfy retired requirements", async () => {
  const data = fixture();
  data.recipe_kitchenware_requirements[0].catalog_id = null;
  data.kitchenware_items = [{ id: 2,user_id: 1,name: "电饭煲",catalog_id: 2,status: "常用" }];
  data.recipe_kitchenware_requirements[0].capability_code = "steam";
  data.kitchenware_catalog_capabilities = [{ catalog_id: 2,capability_code: "steam", constraints_json: {} }];
  assert.equal((await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10)).blocking.length,0);
  data.kitchenware_catalog[1].quality_status = "needs_review";
  assert.equal((await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10)).blocking.length,1);
  data.kitchenware_catalog[1].quality_status = "trusted";
  data.recipe_kitchenware_requirements[0].catalog_id = 1;
  data.kitchenware_catalog[0].quality_status = "needs_review";
  assert.equal((await snapshotKitchenware(inputSnapshot(1,[10],data)).evaluateRequirements(1,10)).blocking.length,1);
});

test("capability constraints use captured device specifications and change the snapshot fingerprint", async () => {
  const data = fixture();
  data.recipe_kitchenware_requirements[0].catalog_id = null;
  data.recipe_kitchenware_requirements[0].capability_code = "steam";
  data.kitchenware_catalog_capabilities = [{ catalog_id: 1,capability_code: "steam",constraints_json: { minCapacityMl: 2000 } }];
  const initial = inputSnapshot(1,[10],data);
  assert.equal((await snapshotKitchenware(initial).evaluateRequirements(1,10)).blocking.length,1);
  data.kitchenware_items[0].attributes_json = { capacityMl: 2000 };
  const verified = inputSnapshot(1,[10],data);
  assert.notEqual(initial.fingerprint,verified.fingerprint);
  assert.equal((await snapshotKitchenware(verified).evaluateRequirements(1,10)).blocking.length,0);
  assert.equal((await snapshotKitchenware(initial).evaluateRequirements(1,10)).blocking.length,1);
});
