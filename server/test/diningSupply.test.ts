import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diningSupply } from '../src/modules/households/diningSupply.js';
import { checkDiningRecipe } from '../src/modules/households/recipeConstraints.js';
const recipe = { id: 1,title: '米饭',description: null,ingredients_json: [{ name: '大米',amount: '100g' }],serving_size: 1 };
const plan = (id: string,date: string,servings: number,protect = false) => ({ id,planned_date: date,protected: protect,recipe_id: 1,recipe_title: '米饭',recipe_description: null,recipe_ingredients: recipe.ingredients_json,recipe_yield: 1,dining_json: { householdId: 1,participants: [{ membershipId: 1,version: 1,servings }],constraintsReviewed: true } });
const run = (plans: ReturnType<typeof plan>[],inventory: Record<string,unknown>[],shopping: Record<string,unknown>[] = []) => diningSupply({ plans,inventory,shopping,targetId: 'target',totalServings: 3,recipeFingerprint: checkDiningRecipe(recipe,[],3).fingerprint,today: '2036-09-12' });
test('shared stock is spent only once across meals, with expiry checked for each meal',() => {
 const inventory = [{ id: 1,food_name: '大米',quantity: '0.3kg',expiration_date: '2036-09-13',is_available: true },{ id: 2,food_name: '大米',quantity: '200g',expiration_date: '2036-09-30',is_available: true }];
 assert.deepEqual(run([plan('earlier','2036-09-12',2),plan('target','2036-09-13',3)],inventory).demands.map(row => [row.covered,row.missing]),[[300,0]]);
 assert.deepEqual(run([plan('earlier','2036-09-12',2),plan('target','2036-09-14',3)],inventory).demands.map(row => [row.covered,row.missing]),[[200,100]]);
 assert.deepEqual(run([plan('future','2036-09-20',2,true),plan('target','2036-09-13',3)],inventory).demands.map(row => [row.covered,row.missing]),[[300,0]]);
 assert.equal(inventory[0].quantity,'0.3kg');
});
test('unknown competing demand never certifies a net shopping quantity',() => {
 const other = plan('other','2036-09-12',1); other.recipe_ingredients = [{ name: '大米',amount: '适量' }];
 const result = run([other,plan('target','2036-09-13',3)],[]);
 assert.equal(result.status,'needs_review'); assert.equal(result.demands[0]?.missing,null);
});

test('expired, uncertain and invalid-date stock never certifies coverage',() => {
 const plans = [plan('target','2036-09-13',3)];
 const expired = run(plans,[{ id: 1,food_name: '大米',quantity: '500g',expiration_date: '2036-09-12',is_available: true }]);
 assert.equal(expired.demands[0]?.covered,0); assert.equal(expired.demands[0]?.missing,300);
 for (const row of [{ quantity: '适量',expiration_date: '2036-09-30' },{ quantity: '500g',expiration_date: '2036-02-30' }]) {
   const uncertain = run(plans,[{ id: 1,food_name: '大米',is_available: true,...row }]);
   assert.equal(uncertain.status,'needs_review'); assert.equal(uncertain.demands[0]?.missing,null);
 }
});

test('shopping coverage is separate from physical stock and pooled rows are allocated only once',() => {
 const result = run([plan('earlier','2036-09-12',2),plan('target','2036-09-13',3)],[],[
   { id: 'own',name: '大米',amount: '200g',source_plan_item_id: 'earlier' },
   { id: 'pool',name: '大米',amount: '0.2kg' },
 ]);
 assert.equal(result.status,'known');
 assert.deepEqual(result.demands.map(row => [row.covered,row.missing,row.shoppingCovered,row.unplanned]),[[0,300,200,100]]);
 const sourceOnly = run([plan('earlier','2036-09-12',2),plan('target','2036-09-13',3)],[],[{ id: 'own',name: '大米',amount: '200g',source_plan_item_id: 'earlier' }]);
 assert.equal(sourceOnly.demands[0]?.shoppingCovered,0); assert.equal(sourceOnly.demands[0]?.unplanned,300);
});
test('transferred and removed purchases cannot be credited a second time',() => {
 const result = run([plan('target','2036-09-13',3)],[{ id: 1,food_name: '大米',quantity: '100g',expiration_date: '2036-09-30',is_available: true }],[
   { id: 'imported',name: '大米',amount: '300g',transferred_at: '2036-09-12' },
   { id: 'removed',name: '大米',amount: '300g',deleted_at: '2036-09-12' },
 ]);
 assert.deepEqual(result.demands.map(row => [row.covered,row.shoppingCovered,row.unplanned]),[[100,0,200]]);
});
test('unknown purchases and surplus source rows require review before more shopping',() => {
 for (const row of [{ id: 'unknown',name: '大米',amount: '适量' },{ id: 'purchased',name: '大米',amount: '300g',checked: true },{ id: 'surplus',name: '大米',amount: '400g',source_plan_item_id: 'target' }]) {
   const result = run([plan('target','2036-09-13',3)],[],[row]);
   assert.equal(result.status,'needs_review'); assert.equal(result.demands[0]?.unplanned,null);
 }
});

test('pooled shopping uses the earliest suitable expiry before longer-lived purchases',() => {
 const result = run([plan('earlier','2036-09-12',2),plan('target','2036-09-20',3)],[],[
   { id: 'z-near',name: '大米',amount: '300g',expiration_date: '2036-09-13' },
   { id: 'a-later',name: '大米',amount: '200g',expiration_date: '2036-09-30' },
 ]);
 assert.equal(result.status,'known'); assert.equal(result.demands[0]?.shoppingCovered,200); assert.equal(result.demands[0]?.unplanned,100);
});

test('net proposal excludes its own generated demand and binds source versions without exposing other plans',async () => {
 const { diningNetShopping,prepareNetDiningShopping } = await import('../src/modules/households/diningNetShopping.js');
 const snapshot = { plans: [plan('target','2036-09-13',3)],inventory: [{ id: 1,version: 1,food_name: '大米',quantity: '100g',expiration_date: '2036-09-30',is_available: true }],shopping: [
   { id: 'own',name: '大米',amount: '300g',source_plan_item_id: 'target',source_demand_key: '["大米","g"]',version: 1,source_generated_version: 1 },
   { id: 'pool',name: '大米',amount: '50g' },
 ],targetId: 'target',totalServings: 3,recipeFingerprint: checkDiningRecipe(recipe,[],3).fingerprint,today: '2036-09-12' };
 const proposal = diningNetShopping(snapshot);
 assert.equal(proposal.status,'ready');
 assert.deepEqual(proposal.lines,[{ key: '["大米","g"]',name: '大米',beforeAmount: '300g',afterAmount: '150g' }]);
 assert.deepEqual(prepareNetDiningShopping(snapshot,proposal.fingerprint!),[{ key: '["大米","g"]',name: '大米',amount: '150g' }]);
 const reordered = { ...snapshot,shopping: [...snapshot.shopping].reverse() };
 assert.equal(diningNetShopping(reordered).fingerprint,proposal.fingerprint);
 snapshot.inventory[0]!.version++;
 assert.throws(() => prepareNetDiningShopping(snapshot,proposal.fingerprint!),/已变化/);
 for (const state of [{ checked: true },{ deleted_at: 'today' },{ transferred_at: 'today' },{ version: 2 }]) {
   assert.equal(diningNetShopping({ ...snapshot,shopping: snapshot.shopping.map(row => row.id==='own' ? { ...row,...state } : row) }).status,'needs_review');
 }
 snapshot.inventory[0]!.quantity='500g';
 assert.equal(diningNetShopping(snapshot).lines[0]?.afterAmount,null);
});
