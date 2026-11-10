import assert from "node:assert/strict";
import type { HouseholdsService } from "../src/modules/households/service.js";
export async function verifyHouseholdDining(service: HouseholdsService,householdId: number,owner: number,member: number,recipeId?: number) {
  const initial = await service.diningPreferences(member,householdId);
  assert.equal(initial.shared,false); assert.deepEqual(initial.allergies,[]);
  const saved = await service.saveDiningPreferences(member,householdId,{ ...initial,shared: true,allergies: ["花生"],restrictions: ["不吃猪肉"] });
  assert.equal(saved.version,initial.version+1);
  assert.equal((await service.diningPreferences(owner,householdId)).shared,false);
  assert.equal(JSON.stringify(await service.mine(owner)).includes("花生"),false);
  await assert.rejects(() => service.saveDiningPreferences(member,householdId,{ ...initial,shared: true,allergies: [],restrictions: [] }),/已变化/);
  const shared = (await service.diningMembers(owner,householdId)).members;
  assert.deepEqual(shared.find(value => value.userId === member),{ membershipId: initial.membershipId,userId: member,name: shared.find(value => value.userId === member)?.name,version: saved.version,shared: true,allergies: ["花生"],restrictions: ["不吃猪肉"] });
  assert.equal(shared.find(value => value.userId === owner)?.shared,false);
  assert.equal("allergies" in shared.find(value => value.userId === owner)!,false);
  if (recipeId) {
    const checked = await service.previewDiningAllocation(owner,householdId,{ recipeId,participants: [{ membershipId: initial.membershipId,version: saved.version,servings: 1 }] });
    assert.equal(checked.recipeCheck?.status,"blocked");
    assert.equal(checked.recipeCheck?.materials.status,"known");
    assert.deepEqual(checked.recipeCheck?.materials.demands,[{ food_name: "花生油",amount_value: 5,unit: "ml" }]);
    assert.ok(checked.recipeCheck?.conflicts.some(item => item.constraint === "花生"));
    await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ recipeId: 2147000000,participants: [{ membershipId: initial.membershipId,version: saved.version,servings: 1 }] }),/不可用于/);
  }
  const selection = { participants: [{ membershipId: initial.membershipId,version: saved.version,servings: 1.5 }] };
  assert.equal((await service.previewDiningAllocation(owner,householdId,selection)).totalServings,1.5);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ participants: [{ ...selection.participants[0]!,version: initial.version }] }),/已变化/);
  const hidden = await service.saveDiningPreferences(member,householdId,{ ...saved,shared: false });
  assert.equal(hidden.shared,false);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,selection),/已变化/);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ participants: [{ ...selection.participants[0]!,version: hidden.version }] }),/尚未授权/);
  const withdrawn = (await service.diningMembers(owner,householdId)).members.find(value => value.userId === member)!;
  assert.equal(withdrawn.shared,false);
  assert.equal("allergies" in withdrawn,false);
  assert.equal("restrictions" in withdrawn,false);
  await service.leave(member,householdId);
  await assert.rejects(() => service.diningMembers(member,householdId),/不是/);
  assert.equal((await service.diningMembers(owner,householdId)).members.some(value => value.userId === member),false);
  await assert.rejects(() => service.diningPreferences(member,householdId),/不是/);
  await assert.rejects(() => service.saveDiningPreferences(member,householdId,hidden),/不是/);
  return initial;
}

export async function verifyHouseholdProduction(service: HouseholdsService, householdId: number,owner: number,member: number) {
  const membership = await service.diningPreferences(owner,householdId);
  const first = await service.createInventory(owner,householdId,{ food_name: "制作鸡蛋",quantity: "6个",expiration_date: "2099-01-01" });
  const second = await service.createInventory(owner,householdId,{ food_name: "制作米",quantity: "100g",expiration_date: "2099-01-01" });
  const input = { idempotencyKey: "78888888-8888-4888-8888-888888888881",membershipId: membership.membershipId,foodName: "家庭蛋饭",producedServings: 3,
    inventory: [{ itemId: Number(first.id),version: Number(first.version),amount: 3,unit: "piece" as const },{ itemId: Number(second.id),version: Number(second.version),amount: 50,unit: "g" as const }] };
  await assert.rejects(() => service.produceMeal(owner,householdId,{ ...input,inventory: [input.inventory[0]!,{ ...input.inventory[1]!,version: 999 }] }),/库存已/);
  assert.equal((await service.inventory(owner,householdId)).find(item => item.id === first.id)?.quantity,"6个");
  const concurrent = await Promise.all([service.produceMeal(owner,householdId,input),service.produceMeal(owner,householdId,input)]);
  assert.deepEqual(concurrent.map(value => value.repeated).sort(),[false,true]);
  assert.equal(concurrent[0]!.id,concurrent[1]!.id);
  const batch = concurrent[0]!;
  assert.equal(batch.producedServings,3); assert.equal(batch.remainingServings,3);
  const replay = await service.produceMeal(owner,householdId,input);
  assert.equal(replay.id,batch.id); assert.equal(replay.repeated,true);
  assert.equal((await service.inventory(owner,householdId)).find(item => item.id === first.id)?.quantity,"3个");
  await assert.rejects(() => service.produceMeal(owner,householdId,{ ...input,producedServings: 4 }),/制作编号/);
  await assert.rejects(() => service.produceMeal(member,householdId,input),/成员身份/);
  return batch;
}

export async function verifyHouseholdEating(service: HouseholdsService,householdId: number,mealId: string,users: number[]) {
  const inventoryBefore = await service.inventory(users[0]!,householdId);
  const selections = await Promise.all(users.map(async (user,index) => ({ user,input: {
    idempotencyKey: `78888888-8888-4888-8888-88888888888${index+2}`,
    membershipId: (await service.diningPreferences(user,householdId)).membershipId,
    version: index === 0 ? 1 : 2,servings: 1,recordedDate: "2026-09-12",recordedTime: "12:00",mealType: "lunch" as const,
  } })));
  const first = await service.eatMeal(users[0]!,householdId,mealId,selections[0]!.input);
  const replay = await service.eatMeal(users[0]!,householdId,mealId,selections[0]!.input);
  assert.equal(replay.repeated,true); assert.equal(replay.dietRecordId,first.dietRecordId);
  const contenders = selections.slice(1);
  const race = await Promise.allSettled(contenders.map(item => service.eatMeal(item.user,householdId,mealId,item.input)));
  assert.equal(race.filter(item => item.status === "fulfilled").length,1);
  const rejectedIndex = race.findIndex(item => item.status === "rejected");
  assert.ok(rejectedIndex >= 0);
  const loser = contenders[rejectedIndex]!;
  const last = await service.eatMeal(loser.user,householdId,mealId,{ ...loser.input,version: 3 });
  assert.equal((last.meal as { remainingServings: number }).remainingServings,0);
  await assert.rejects(() => service.eatMeal(users[0]!,householdId,mealId,{ ...selections[0]!.input,idempotencyKey: "78888888-8888-4888-8888-888888888889",version: 4 }),/不足/);
  const listed = await service.meals(users[0]!,householdId);
  assert.equal(listed.find(item => item.id === mealId)?.remainingServings,0);
  assert.equal(JSON.stringify(listed).includes("dietRecord"),false);
  assert.deepEqual(await service.inventory(users[0]!,householdId),inventoryBefore);
  for (const item of inventoryBefore) await service.removeInventory(users[0]!,householdId,Number(item.id),Number(item.version));
  await service.leave(users[2]!,householdId);
  await assert.rejects(() => service.meals(users[2]!,householdId),/不是/);
  await assert.rejects(() => service.eatMeal(users[2]!,householdId,mealId,selections[2]!.input),/成员身份/);
}

export async function verifyHouseholdCorrections(service: HouseholdsService,diet: Pick<import("../src/modules/dietRecords/repository.js").DietRecordsRepository,"remove" | "list">,householdId: number,owner: number,member: number,inviteCode: string) {
  const stock = await service.createInventory(owner,householdId,{ food_name: "更正原料",quantity: "6个",expiration_date: "2099-01-01" });
  const membershipId = (await service.diningPreferences(owner,householdId)).membershipId;
  const otherMembership = (await service.diningPreferences(member,householdId)).membershipId;
  const meal = await service.produceMeal(owner,householdId,{ idempotencyKey: "78888888-8888-4888-8888-888888888810",membershipId,foodName: "更正测试餐",producedServings: 2,inventory: [{ itemId: Number(stock.id),version: Number(stock.version),amount: 2,unit: "piece" }] });
  const input = { idempotencyKey: "78888888-8888-4888-8888-888888888811",membershipId,version: 1,servings: 1,recordedDate: "2026-09-12",recordedTime: null,mealType: "lunch" as const };
  const first = await service.eatMeal(owner,householdId,String(meal.id),input);
  const id = Number(first.dietRecordId);
  assert.equal((await diet.list(owner)).find(record => Number(record.id) === id)?.household_meal_id,meal.id);
  await assert.rejects(() => diet.remove(owner,id),/选择/);
  assert.equal(await diet.remove(member,id,"delete_intake"),false);
  assert.deepEqual(await Promise.all([diet.remove(owner,id,"undo_eating"),diet.remove(owner,id,"undo_eating")]),[true,true]);
  assert.equal((await service.meals(owner,householdId)).find(item => item.id === meal.id)?.remainingServings,2);
  await assert.rejects(() => diet.remove(owner,id,"delete_intake"),/另一种/);
  assert.equal((await service.eatMeal(owner,householdId,String(meal.id),input)).repeated,true);
  assert.equal((await diet.list(owner)).some(record => Number(record.id) === id),false);
  const second = await service.eatMeal(owner,householdId,String(meal.id),{ ...input,idempotencyKey: "78888888-8888-4888-8888-888888888812",version: 3 });
  const third = await service.eatMeal(member,householdId,String(meal.id),{ ...input,membershipId: otherMembership,idempotencyKey: "78888888-8888-4888-8888-888888888813",version: 4 });
  await assert.rejects(() => diet.remove(owner,Number(second.dietRecordId),"undo_eating"),/已有变化/);
  await diet.remove(owner,Number(second.dietRecordId),"delete_intake");
  await service.leave(member,householdId);
  await assert.rejects(() => diet.remove(member,Number(third.dietRecordId),"undo_eating"),/成员身份/);
  await diet.remove(member,Number(third.dietRecordId),"delete_intake");
  assert.equal((await service.meals(owner,householdId)).find(item => item.id === meal.id)?.remainingServings,0);
  assert.equal((await service.inventory(owner,householdId)).find(item => item.id === stock.id)?.quantity,"4个");
  await service.removeInventory(owner,householdId,Number(stock.id),Number(stock.version)+1);
  await service.join(member,inviteCode);
}

export async function verifyHouseholdReservations(service: HouseholdsService,diet: Pick<import("../src/modules/dietRecords/repository.js").DietRecordsRepository,"remove">,householdId: number,owner: number,member: number,inviteCode: string) {
  const stock = await service.createInventory(owner,householdId,{ food_name: "预留原料",quantity: "6个",expiration_date: "2099-01-01" });
  const own = (await service.diningPreferences(owner,householdId)).membershipId;
  const other = (await service.diningPreferences(member,householdId)).membershipId;
  const batch = await service.produceMeal(owner,householdId,{ idempotencyKey: "78888888-8888-4888-8888-888888888820",membershipId: own,foodName: "预留餐",producedServings: 3,inventory: [{ itemId: Number(stock.id),version: Number(stock.version),amount: 3,unit: "piece" }] });
  const mealId = String(batch.id);
  await service.reserveMeal(owner,householdId,mealId,{ membershipId: own,version: 1,servings: 2 });
  await assert.rejects(() => service.reserveMeal(member,householdId,mealId,{ membershipId: other,version: 2,servings: 2 }),/不足/);
  await service.reserveMeal(member,householdId,mealId,{ membershipId: other,version: 2,servings: 1 });
  const mine = (await service.meals(owner,householdId)).find(item => item.id === mealId)!;
  assert.equal(mine.availableServings,2); assert.equal(mine.myReservedServings,2); assert.equal(mine.reservedServings,3);
  const input = { idempotencyKey: "78888888-8888-4888-8888-888888888821",membershipId: own,version: 3,servings: 0.5,recordedDate: "2026-09-12",recordedTime: null,mealType: "lunch" as const };
  const eaten = await service.eatMeal(owner,householdId,mealId,input);
  assert.equal((await service.meals(owner,householdId)).find(item => item.id === mealId)?.myReservedServings,1.5);
  await diet.remove(owner,Number(eaten.dietRecordId),"undo_eating");
  assert.equal((await service.meals(owner,householdId)).find(item => item.id === mealId)?.myReservedServings,2);
  const race = await Promise.allSettled([1,2].map(() => service.reserveMeal(owner,householdId,mealId,{ membershipId: own,version: 5,servings: 2 })));
  assert.equal(race.filter(item => item.status === "fulfilled").length,1);
  await service.reserveMeal(owner,householdId,mealId,{ membershipId: own,version: 6,servings: 0 });
  await service.eatMeal(owner,householdId,mealId,{ ...input,idempotencyKey: "78888888-8888-4888-8888-888888888822",version: 7,servings: 2 });
  await assert.rejects(() => service.eatMeal(owner,householdId,mealId,{ ...input,idempotencyKey: "78888888-8888-4888-8888-888888888823",version: 8 }),/其他成员预留/);
  await service.leave(member,householdId);
  assert.equal((await service.meals(owner,householdId)).find(item => item.id === mealId)?.availableServings,1);
  await assert.rejects(() => service.reserveMeal(member,householdId,mealId,{ membershipId: other,version: 8,servings: 1 }),/成员身份/);
  await service.join(member,inviteCode);
  assert.equal((await service.meals(member,householdId)).find(item => item.id === mealId)?.myReservedServings,0);
  assert.equal((await service.inventory(owner,householdId)).find(item => item.id === stock.id)?.quantity,"3个");
  await service.removeInventory(owner,householdId,Number(stock.id),Number(stock.version)+1);
}


export async function verifyHouseholdPlanPreview(service: HouseholdsService, householdId: number, owner: number, other: number, recipeId: number,
  query: (sql: string,args?: unknown[]) => Promise<Record<string,unknown>[]>) {
  const original = await service.diningPreferences(owner,householdId);
  const consent = await service.saveDiningPreferences(owner,householdId,{ ...original,shared: true });
  const planId = "dining-context-plan", itemId = "dining-context-item";
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status) VALUES(?,?,'共餐预览','2036-09-12','2036-09-18','active')",[planId,owner]);
  await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id) VALUES(?,?,?,'2036-09-12','lunch','共餐原餐',?)",[itemId,planId,owner,recipeId]);
  const input = { planItem: { planId,itemId,version: 1 },participants: [{ membershipId: consent.membershipId,version: consent.version,servings: 2 }] };
  const before = await query("SELECT * FROM meal_plan_items WHERE id=?",[itemId]);
  const dietBefore = await query("SELECT count(*) AS n FROM diet_records WHERE user_id=?",[owner]);
  const preview = await service.previewDiningAllocation(owner,householdId,input);
  assert.deepEqual(preview.planItem,{ ...input.planItem,plannedDate: '2036-09-12',mealType: 'lunch',title: '共餐原餐',decision: 'apply',applied: false });
  assert.equal(preview.recipeCheck?.materials.status,'known');
  assert.deepEqual(await query("SELECT * FROM meal_plan_items WHERE id=?",[itemId]),before);
  assert.deepEqual(await query("SELECT count(*) AS n FROM diet_records WHERE user_id=?",[owner]),dietBefore);
  await assert.rejects(() => service.previewDiningAllocation(other,householdId,input),/不存在或不可用于/);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ ...input,planItem: { ...input.planItem,version: 2 } }),/已变化/);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ ...input,recipeId: recipeId+1 }),/不一致/);
  await query("INSERT INTO shopping_list_items(id,user_id,client_id,name,checked) VALUES('dining-context-shopping',?,?,'已采购花生油',true)",[owner,`meal-plan:${itemId}:oil`]);
  assert.equal((await service.previewDiningAllocation(owner,householdId,input)).planItem?.decision,'suggest');
  await query("DELETE FROM shopping_list_items WHERE id='dining-context-shopping'");
  await query("UPDATE meal_plan_items SET confirmed_at=CURRENT_TIMESTAMP WHERE id=?",[itemId]);
  assert.equal((await service.previewDiningAllocation(owner,householdId,input)).planItem?.decision,'suggest');
  await query("UPDATE meal_plan_items SET status='queued' WHERE id=?",[itemId]);
  assert.equal((await service.previewDiningAllocation(owner,householdId,input)).planItem?.decision,'keep');
  await query("UPDATE meal_plans SET status='draft' WHERE id=?",[planId]);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,input),/不存在或不可用于/);
  await query("DELETE FROM meal_plans WHERE id=?",[planId]);
  await service.saveDiningPreferences(owner,householdId,{ ...consent,shared: original.shared });
}

export async function verifyHouseholdPlanProduction(service: HouseholdsService, plans: import("../src/modules/mealPlans/repository.js").MealPlansRepository,
  householdId: number, owner: number, other: number, query: (sql: string,args?: unknown[]) => Promise<Record<string,unknown>[]>) {
  const planId = "household-source-plan", itemId = "98888888-8888-4888-8888-888888888880";
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status) VALUES(?,?,'来源计划','2036-09-12','2036-09-18','active')",[planId,owner]);
  for (const id of [itemId,'household-unrelated-meal']) await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title) VALUES(?,?,?,'2036-09-12','lunch','原餐')",[id,planId,owner]);
  const unrelated = await query("SELECT * FROM meal_plan_items WHERE id='household-unrelated-meal'");
  const stock = await service.createInventory(owner,householdId,{ food_name: "来源制作米",quantity: "600g",expiration_date: "2099-01-01" });
  const input = { idempotencyKey: "98888888-8888-4888-8888-888888888881",membershipId: (await service.diningPreferences(owner,householdId)).membershipId,
    planItem: { planId,itemId,version: 1 },foodName: "三人米饭",producedServings: 3,
    inventory: [{ itemId: Number(stock.id),version: Number(stock.version),amount: 300,unit: 'g' as const }] };
  const dietBefore = await query("SELECT count(*) AS n FROM diet_records WHERE user_id=?",[owner]);
  await assert.rejects(() => service.produceMeal(other,householdId,{ ...input,membershipId: 2147000000 }),/成员身份/);
  const otherInput = { ...input,membershipId: (await service.diningPreferences(other,householdId)).membershipId };
  await assert.rejects(() => service.produceMeal(other,householdId,otherInput),/不是本人/);
  await assert.rejects(() => service.produceMeal(owner,householdId,{ ...input,planItem: { ...input.planItem,version: 2 } }),/已变化/);
  await query("UPDATE meal_plan_items SET status='queued' WHERE id=?",[itemId]);
  await assert.rejects(() => service.produceMeal(owner,householdId,input),/已变化/);
  await query("UPDATE meal_plan_items SET status='planned',confirmed_at=CURRENT_TIMESTAMP WHERE id=?",[itemId]);
  await assert.rejects(() => service.produceMeal(owner,householdId,{ ...input,inventory: [{ ...input.inventory[0]!,amount: 700 }] }));
  assert.equal((await query("SELECT status FROM meal_plan_items WHERE id=?",[itemId]))[0]?.status,'planned');
  assert.equal((await service.inventory(owner,householdId)).find(row => row.id === stock.id)?.quantity,'600g');
  const results = await Promise.allSettled([service.produceMeal(owner,householdId,input),service.produceMeal(owner,householdId,{ ...input,idempotencyKey: "98888888-8888-4888-8888-888888888882" })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
  const successful = results.findIndex(result => result.status === 'fulfilled');
  const savedInput = successful === 0 ? input : { ...input,idempotencyKey: "98888888-8888-4888-8888-888888888882" };
  const batch = await service.produceMeal(owner,householdId,savedInput);
  assert.equal(batch.repeated,true); assert.equal(batch.remainingServings,3);
  await assert.rejects(() => service.produceMeal(owner,householdId,{ ...savedInput,planItem: undefined }),/制作编号/);
  assert.deepEqual(await query("SELECT status,version,diet_record_id FROM meal_plan_items WHERE id=?",[itemId]),[{ status: 'completed',version: 2,diet_record_id: null }]);
  assert.equal((await service.inventory(owner,householdId)).find(row => row.id === stock.id)?.quantity,'300g');
  assert.deepEqual(await query("SELECT count(*) AS n FROM diet_records WHERE user_id=?",[owner]),dietBefore);
  assert.deepEqual(await query("SELECT * FROM meal_plan_items WHERE id='household-unrelated-meal'"),unrelated);
  const plan = await plans.find(owner,planId,false);
  const displayed = (plan?.items as Record<string,unknown>[]).find(item => item.id === itemId);
  assert.equal(displayed?.householdMealId,batch.id); assert.equal(displayed?.householdId,householdId);
  await assert.rejects(() => plans.complete(owner,planId,itemId,{ version: 2,idempotencyKey: "98888888-8888-4888-8888-888888888885",production: { food_name: "重复个人产出",produced_servings: 3,eaten_servings: 0,nutrition_per_serving: {},meal_type: 'lunch' } }),/餐次已变化/);
  assert.equal((await query("SELECT count(*) AS n FROM prepared_meals WHERE plan_item_id=?",[itemId]))[0]?.n?.toString(),'0');
  assert.equal((await query("SELECT count(*) AS n FROM plan_maintenance_events WHERE source_id=?",[`household:${batch.id}`]))[0]?.n?.toString(),'1');
  assert.equal((await plans.enqueue(owner,planId,itemId,{ version: 2,idempotencyKey: "98888888-8888-4888-8888-888888888884" })).kind,'version_conflict');
  assert.equal((await plans.complete(owner,planId,itemId,{ version: 2,idempotencyKey: "98888888-8888-4888-8888-888888888883" })).kind,'version_conflict');
  assert.deepEqual(await query("SELECT count(*) AS n FROM diet_records WHERE user_id=?",[owner]),dietBefore);
  await query("DELETE FROM household_inventory_items WHERE id=?",[stock.id]);
  await query("DELETE FROM meal_plans WHERE id=?",[planId]);
  assert.equal((await service.meals(owner,householdId)).find(row => row.id === batch.id)?.remainingServings,3);
}

export async function verifyDiningPlanChanges(service: HouseholdsService,plans: import("../src/modules/mealPlans/repository.js").MealPlansRepository,diet: Pick<import("../src/modules/dietRecords/repository.js").DietRecordsRepository,"completeCooking">,
  householdId: number,owner: number,member: number,recipeId: number,invite: string,query: (sql: string,args?: unknown[]) => Promise<Record<string,unknown>[]>) {
  const third = Number((await query("INSERT INTO users(username,email,password_hash) VALUES('dining-plan-third','dining-plan-third@example.com','hash') RETURNING id"))[0]?.id);
  await service.join(third,invite);
  const people = await Promise.all([owner,member,third].map(async userId => {
    const old = await service.diningPreferences(userId,householdId);
    return { userId,old,saved: await service.saveDiningPreferences(userId,householdId,{ ...old,shared: true,allergies: [],restrictions: [] }) };
  }));
  const planId = 'dining-change-plan',itemId = '98888888-8888-4888-8888-888888888890';
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status) VALUES(?,?,'共餐计划','2036-09-12','2036-09-18','active')",[planId,owner]);
  await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id) VALUES(?,?,?,'2036-09-12','lunch','原餐',?)",[itemId,planId,owner,recipeId]);
  let dining = { householdId,constraintsReviewed: true as const,participants: people.map(person => ({ membershipId: person.saved.membershipId,version: person.saved.version,servings: 1 })) };
  const originalDiet = await query("SELECT count(*) AS n FROM diet_records WHERE user_id=?",[owner]);
  const read = async () => ((await plans.find(owner,planId,false))?.items as Record<string,unknown>[])[0]!;
  const applied = await plans.updateItem(owner,planId,itemId,{ version: 1,dining });
  assert.equal(applied.kind,'updated'); if (applied.kind !== 'updated') throw new Error('missing applied change');
  assert.deepEqual((await read()).dining,dining);
  await assert.rejects(() => plans.enqueue(owner,planId,itemId,{ version: 2,idempotencyKey: 'dining-plan-queue' }),/家庭制作/);
  await assert.rejects(() => plans.complete(owner,planId,itemId,{ version: 2,idempotencyKey: 'dining-plan-complete' }),/家庭制作/);
  await assert.rejects(() => plans.addShopping(owner,planId,itemId,{ version: 2,idempotencyKey: 'dining-plan-shopping' }),/家庭采购/);
  await assert.rejects(() => diet.completeCooking(owner,{ idempotency_key: "dining-direct-private-production",recipe_id: recipeId,inventory_item_ids: [],inventory_consumptions: [],production: {
    food_name: "错误个人产出",produced_servings: 3,eaten_servings: 3,eaten_at: "2036-09-12",meal_type: "lunch",nutrition_per_serving: {},plan_item_id: itemId,plan_version: 2,
  } }),/家庭制作/);
  await assert.rejects(() => plans.updateItem(owner,planId,itemId,{ version: 2,recipeId: null }),/更换共餐菜谱/);
  const change = applied.value.change as { id: string; status: string };
  assert.equal(change.status,'applied');
  assert.equal((await plans.reviewChange(owner,planId,change.id,'restore')).kind,'updated');
  assert.equal((await read()).dining,null);
  await plans.confirmItem(owner,planId,itemId,3);
  const pending = await plans.updateItem(owner,planId,itemId,{ version: 4,dining });
  assert.equal(pending.kind,'updated'); if (pending.kind !== 'updated') throw new Error('missing suggestion');
  const pendingId = (pending.value.change as { id: string }).id;
  assert.equal((pending.value.change as { status: string }).status,'pending'); assert.equal((await read()).dining,null);
  const changedMember = await service.saveDiningPreferences(member,householdId,{ ...people[1]!.saved,shared: true,allergies: ['花生'] });
  await assert.rejects(() => plans.reviewChange(owner,planId,pendingId,'accept'),/已变化/);
  dining = { ...dining,participants: dining.participants.map(person => person.membershipId === changedMember.membershipId ? { ...person,version: changedMember.version } : person) };
  await assert.rejects(() => plans.updateItem(owner,planId,itemId,{ version: 4,dining }),/明确忌口冲突/);
  const clear = await service.saveDiningPreferences(member,householdId,{ ...changedMember,allergies: [] });
  dining = { ...dining,participants: dining.participants.map(person => person.membershipId === clear.membershipId ? { ...person,version: clear.version } : person) };
  await plans.reviewChange(owner,planId,pendingId,'reject');
  const next = await plans.updateItem(owner,planId,itemId,{ version: 4,dining });
  if (next.kind !== 'updated') throw new Error('missing fresh suggestion');
  assert.equal((await plans.reviewChange(owner,planId,(next.value.change as { id: string }).id,'accept')).kind,'updated');
  assert.deepEqual((await read()).dining,dining);
  await query("UPDATE meal_plan_items SET confirmed_at=NULL WHERE id=?",[itemId]);
  const near = await service.createInventory(owner,householdId,{ food_name: '花生油',quantity: '10ml',expiration_date: '2036-09-12' });
  const later = await service.createInventory(owner,householdId,{ food_name: '花生油',quantity: '10ml',expiration_date: '2036-09-30' });
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status) VALUES('supply-other-plan',?,'另一位成员的计划','2036-09-11','2036-09-30','active')",[member]);
  await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,dining_json) VALUES('supply-other-item','supply-other-plan',?,'2036-09-11','lunch','另一餐',?,?)",[member,recipeId,JSON.stringify(dining)]);
  const supplyInput = { planItem: { planId,itemId,version: 5 },participants: dining.participants };
  const sharedSupply = (await service.previewDiningAllocation(owner,householdId,supplyInput)).supply!;
  assert.equal(sharedSupply.otherMealCount,1); assert.equal(sharedSupply.status,'known');
  assert.equal(sharedSupply.demands[0]?.covered,5); assert.equal(sharedSupply.demands[0]?.missing,10);
  await query("UPDATE meal_plan_items SET planned_date='2036-09-20',confirmed_at=CURRENT_TIMESTAMP WHERE id='supply-other-item'");
  const futureSupply = (await service.previewDiningAllocation(owner,householdId,supplyInput)).supply!;
  assert.equal(futureSupply.demands[0]?.covered,10); assert.equal(futureSupply.demands[0]?.missing,5);
  await query("UPDATE meal_plan_items SET recipe_id=NULL WHERE id='supply-other-item'");
  const unknownSupply = (await service.previewDiningAllocation(owner,householdId,supplyInput)).supply!;
  assert.equal(unknownSupply.status,'needs_review'); assert.equal(unknownSupply.demands[0]?.missing,null);
  assert.equal((await service.inventory(owner,householdId)).find(row => row.id===near.id)?.quantity,'10ml');
  assert.equal((await service.inventory(owner,householdId)).find(row => row.id===later.id)?.quantity,'10ml');
  await query("DELETE FROM meal_plans WHERE id='supply-other-plan'");
  await query("DELETE FROM household_inventory_items WHERE id=? OR id=?",[near.id,later.id]);
  const demandPreview = await service.previewDiningAllocation(owner,householdId,{ recipeId,participants: dining.participants });
  const shoppingInput = { version: 5,idempotencyKey: 'dining-total-shopping-first',householdTotalDemand: dining,householdRecipeFingerprint: demandPreview.recipeCheck!.fingerprint };
  await assert.rejects(() => plans.addShopping(owner,planId,itemId,{ ...shoppingInput,householdTotalDemand: { ...dining,participants: dining.participants.slice(0,2) } }),/预览与已保存/);
  await assert.rejects(() => plans.addShopping(owner,planId,itemId,{ ...shoppingInput,householdRecipeFingerprint: '0'.repeat(64) }),/菜谱内容已变化/);
  const shopping = await plans.addShopping(owner,planId,itemId,shoppingInput);
  if (shopping.kind !== 'completed') throw new Error('missing household shopping');
  assert.equal(shopping.value.added,1); assert.equal(shopping.value.householdId,householdId);
  let generated = (await service.shoppingList(owner,householdId)).find(row => (shopping.value.itemIds as string[]).includes(String(row.id)))!;
  assert.equal(generated.amount,'15ml'); assert.equal(generated.category,'共餐总需求');
  const listedSupply = (await service.previewDiningAllocation(owner,householdId,supplyInput)).supply!;
  assert.equal(listedSupply.demands[0]?.covered,0); assert.equal(listedSupply.demands[0]?.shoppingCovered,15); assert.equal(listedSupply.demands[0]?.unplanned,0);
  const received = await service.createInventory(owner,householdId,{ food_name: '花生油',quantity: '5ml',expiration_date: '2036-09-30' });
  await query("UPDATE household_shopping_items SET transferred_at=CURRENT_TIMESTAMP WHERE id=?",[generated.id]);
  const receivedSupply = (await service.previewDiningAllocation(owner,householdId,supplyInput)).supply!;
  assert.equal(receivedSupply.demands[0]?.covered,5); assert.equal(receivedSupply.demands[0]?.shoppingCovered,0); assert.equal(receivedSupply.demands[0]?.unplanned,10);
  await query("UPDATE household_shopping_items SET transferred_at=NULL WHERE id=?",[generated.id]);
  await query("DELETE FROM household_inventory_items WHERE id=?",[received.id]);

  assert.equal((await plans.addShopping(owner,planId,itemId,shoppingInput)).kind,'completed');
  await assert.rejects(() => plans.addShopping(owner,planId,itemId,{ ...shoppingInput,householdRecipeFingerprint: '0'.repeat(64) }),/采购编号已用于/);
  const freshSync = await plans.addShopping(owner,planId,itemId,{ ...shoppingInput,idempotencyKey: 'dining-total-shopping-second' });
  if (freshSync.kind !== 'completed') throw new Error('missing repeated synchronization');
  assert.equal(freshSync.value.added,0);
  await query("UPDATE recipes SET ingredients_json=? WHERE id=?",['[{"name":"花生油","amount":"20ml"}]',recipeId]);
  const revisedPreview = await service.previewDiningAllocation(owner,householdId,{ recipeId,participants: dining.participants });
  const revised = await plans.addShopping(owner,planId,itemId,{ ...shoppingInput,idempotencyKey: 'dining-total-shopping-revised',householdRecipeFingerprint: revisedPreview.recipeCheck!.fingerprint });
  assert.equal(revised.kind,'completed');
  generated = (await service.shoppingList(owner,householdId)).find(row => row.id===generated.id)!;
  assert.equal(generated.amount,'30ml'); assert.equal(generated.version,2);
  await query("UPDATE recipes SET ingredients_json=? WHERE id=?",['[{"name":"花生油","amount":"10ml"}]',recipeId]);
  await plans.addShopping(owner,planId,itemId,{ ...shoppingInput,idempotencyKey: 'dining-total-shopping-restored' });
  generated = (await service.shoppingList(owner,householdId)).find(row => row.id===generated.id)!;
  assert.equal(generated.amount,'15ml'); assert.equal(generated.version,3);
  const netStock = await service.createInventory(owner,householdId,{ food_name: '花生油',quantity: '5ml',expiration_date: '2036-09-30' });
  const netPreview = (await service.previewDiningAllocation(owner,householdId,supplyInput)).supply!.netShopping!;
  assert.equal(netPreview.status,'ready');
  assert.equal(netPreview.lines[0]?.beforeAmount,'15ml'); assert.equal(netPreview.lines[0]?.afterAmount,'10ml');
  const netInput = { ...shoppingInput,idempotencyKey: 'dining-net-first',householdNetFingerprint: netPreview.fingerprint! };
  await query("UPDATE household_inventory_items SET version=version+1 WHERE id=?",[netStock.id]);
  await assert.rejects(() => plans.addShopping(owner,planId,itemId,netInput),/库存、餐次或清单已变化/);
  assert.equal((await service.shoppingList(owner,householdId)).find(row => row.id===generated.id)?.amount,'15ml');
  const freshNet = (await service.previewDiningAllocation(owner,householdId,supplyInput)).supply!.netShopping!;
  const appliedNetInput = { ...netInput,householdNetFingerprint: freshNet.fingerprint! };
  const netResults = await Promise.allSettled([plans.addShopping(owner,planId,itemId,appliedNetInput),plans.addShopping(owner,planId,itemId,appliedNetInput)]);
  assert.ok(netResults.some(result => result.status==='fulfilled' && result.value.kind==='completed'));
  for (const result of netResults) {
    if (result.status==='fulfilled') {
      assert.equal(result.value.kind,'completed');
      if (result.value.kind==='completed') assert.equal(result.value.value.mode,'net_demand');
    } else assert.match(String(result.reason),/家庭数据正在变化/);
  }
  generated = (await service.shoppingList(owner,householdId)).find(row => row.id===generated.id)!;
  assert.equal(generated.amount,'10ml'); assert.equal(generated.version,4);
  assert.equal((await plans.addShopping(owner,planId,itemId,appliedNetInput)).kind,'completed');
  await assert.rejects(() => plans.addShopping(owner,planId,itemId,{ ...appliedNetInput,householdNetFingerprint: undefined }),/采购编号已用于/);
  assert.equal((await service.inventory(owner,householdId)).find(row => row.id===netStock.id)?.quantity,'5ml');
  await query("DELETE FROM household_inventory_items WHERE id=?",[netStock.id]);
  await service.updateShopping(member,householdId,String(generated.id),{ version: Number(generated.version),checked: true });
  await query("UPDATE meal_plan_items SET confirmed_at=NULL WHERE id=?",[itemId]);
  const purchasedChange = await plans.updateItem(owner,planId,itemId,{ version: 5,dining: null });
  if (purchasedChange.kind !== 'updated') throw new Error('missing purchase protection');
  assert.equal((purchasedChange.value.change as { status: string }).status,'pending');
  const purchasePreview = await service.previewDiningAllocation(owner,householdId,{ planItem: { planId,itemId,version: 5 },participants: dining.participants });
  assert.equal(purchasePreview.planItem?.decision,'suggest');
  await assert.rejects(() => plans.addShopping(owner,planId,itemId,{ ...shoppingInput,idempotencyKey: 'dining-total-shopping-third' }),/已购买、入库或手动修改/);
  const stock = await service.createInventory(owner,householdId,{ food_name: '共餐制作米',quantity: '600g',expiration_date: '2099-01-01' });
  const batch = await service.produceMeal(owner,householdId,{ idempotencyKey: '98888888-8888-4888-8888-888888888891',membershipId: people[0]!.saved.membershipId,
    planItem: { planId,itemId,version: 5 },foodName: '共餐已制作',producedServings: 3,inventory: [{ itemId: Number(stock.id),version: Number(stock.version),amount: 300,unit: 'g' }] });
  const captured = (await query("SELECT dining_json FROM household_meal_batches WHERE id=?",[batch.id]))[0]?.dining_json;
  assert.deepEqual(typeof captured === 'string' ? JSON.parse(captured) : captured,dining);
  assert.deepEqual(await query("SELECT count(*) AS n FROM diet_records WHERE user_id=?",[owner]),originalDiet);
  const blocked = await plans.updateItem(owner,planId,itemId,{ version: 6,dining: null });
  if (blocked.kind !== 'updated') throw new Error('missing blocked change');
  assert.equal((blocked.value.change as { status: string }).status,'blocked');
  assert.deepEqual((await read()).dining,dining);
  await query("DELETE FROM household_inventory_items WHERE id=?",[stock.id]);
  await query("DELETE FROM meal_plans WHERE id=?",[planId]);
  await query("DELETE FROM household_shopping_items WHERE id=?",[generated.id]);
  for (const person of people) {
    const latest = await service.diningPreferences(person.userId,householdId);
    await service.saveDiningPreferences(person.userId,householdId,{ ...latest,shared: person.old.shared,allergies: person.old.allergies,restrictions: person.old.restrictions });
  }
  await service.leave(third,householdId);
}
