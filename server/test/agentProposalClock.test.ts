import assert from 'node:assert/strict';
import { agentMealProduction, agentPreparedMealEvent } from '../src/services/agent/mealPayload.js';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { SqliteAgentOperationsRepository } from '../src/modules/agentOperations/sqliteRepository.js';
import { validateAgentActions } from '../src/services/agent/policy.js';
import { buildUserContext, buildAIPromptMessages } from '../src/services/contextBuilder.js';
import { configureAiContextService } from '../src/modules/aiContext/runtime.js';
import { AiContextService } from '../src/modules/aiContext/service.js';
import type { RecommendationsService } from '../src/modules/recommendations/service.js';
import { configureRecommendationsService } from '../src/modules/recommendations/runtime.js';
test('diet proposals retain their context date when approved after Shanghai midnight', async t => {
  const { configureAIRuntimeService } = await import('../src/modules/aiRuntime/runtime.js');
  const { AIRuntimeService } = await import('../src/modules/aiRuntime/service.js');
  configureAIRuntimeService(new AIRuntimeService({ settings: async () => ({}), saveSettings: async () => {}, compareAndSaveSetting: async () => false, recordUsage: async () => {} }, {}));
  t.mock.timers.enable({apis:['Date'], now: new Date('2026-12-31T15:59:59Z')});
  configureAiContextService(new AiContextService({load: async () => ({user:null,inventory:[],kitchenware:[],todayDiet:[],latestHealth:null,healthProfile:null,personaPrompt:''})}));
  configureRecommendationsService({compute:async()=>({results:[]})} as unknown as RecommendationsService);
  const before = await buildUserContext(1);
  assert.equal(before.clock!.local_date, '2026-12-31');
  for (const recordedAt of [undefined, '今天', 'today']) {
    const [action] = validateAgentActions([{actionType:'record_diet_meal',summary:'记录今天晚餐',payload:{foodName:'米饭',mealType:'晚餐',amount:'1份',recordedAt}}],before);
    assert.equal(action.payload.recordedAt,'2026-12-31');
    t.mock.timers.setTime(new Date('2026-12-31T16:00:01Z').getTime());
    const after = await buildUserContext(1);
    assert.equal(after.clock!.local_date,'2027-01-01');
    assert.equal(validateAgentActions([{ actionType: action.actionType, summary: action.summary, payload: action.payload }], after)[0].payload.recordedAt, '2026-12-31');
    assert.equal(JSON.parse(buildAIPromptMessages(before).at(-1)!.content.split('\n')[1]).local_date,'2026-12-31');
    const db = new Database(':memory:'); t.after(()=>db.close());
    db.exec(`CREATE TABLE agent_runs(id TEXT,user_id INTEGER,status TEXT);
      CREATE TABLE agent_actions(id TEXT,run_id TEXT,user_id INTEGER,action_type TEXT,status TEXT,before_json TEXT,result_json TEXT,executed_at TEXT,undone_at TEXT,updated_at TEXT);
      CREATE TABLE diet_records(id INTEGER PRIMARY KEY,user_id INTEGER,meal_type TEXT,food_name TEXT,amount TEXT,calories INTEGER,protein REAL,carbs REAL,fat REAL,recorded_at TEXT,recorded_time TEXT);
      INSERT INTO agent_runs VALUES('run',1,'running');
      INSERT INTO agent_actions(id,run_id,user_id,action_type,status) VALUES('action','run',1,'record_diet_meal','awaiting_approval');`);
    await new SqliteAgentOperationsRepository(db).executeActions(1,'run',[{...action,id:'action'}]);
    const row = db.prepare('SELECT recorded_at,recorded_time FROM diet_records').get() as { recorded_at: string; recorded_time: string | null };
    assert.equal(row.recorded_at,'2026-12-31');
    assert.equal(row.recorded_time,null);
  }
  const meal = { actionType: 'record_prepared_meal_event', summary: '吃完备餐', payload: {
    mealId: '00000000-0000-4000-8000-000000000001', version: 1, type: 'eat', servings: 1,
  } };
  const production = { actionType: 'produce_meal', summary: '完成制作并吃了一份', payload: {
    inventory_item_ids: [], production: { food_name: '米饭', produced_servings: 2, eaten_servings: 1 },
  } };
  const after = await buildUserContext(1);
  const [frozenMeal, frozenProduction] = validateAgentActions([meal, production], before);
  const revalidated = validateAgentActions([frozenMeal, frozenProduction].map(({ actionType, summary, payload }) => ({ actionType, summary, payload })), after);
  assert.equal(agentPreparedMealEvent(revalidated[0].payload, 'delayed-meal-event').input.recorded_at, '2026-12-31');
  assert.equal(agentMealProduction(revalidated[1].payload, 'delayed-production').production.eaten_at, '2026-12-31');
  assert.equal(agentPreparedMealEvent(revalidated[0].payload, 'delayed-meal-event').input.recorded_time, null);
  assert.equal(agentMealProduction(revalidated[1].payload, 'delayed-production').production.eaten_time, null);
  const [datedMeal, datedProduction] = validateAgentActions([
    { ...meal, payload: { ...meal.payload, recorded_at: '2026-12-30', recorded_time: '18:30' } },
    { ...production, payload: { ...production.payload, production: { ...production.payload.production, eaten_at: '2026-12-30', eaten_time: '18:30' } } },
  ], before);
  assert.equal(agentPreparedMealEvent(datedMeal.payload, 'explicit-meal-event').input.recorded_at, '2026-12-30');
  assert.equal(agentMealProduction(datedProduction.payload, 'explicit-production').production.eaten_time, '18:30');
  const [discarded, uneaten] = validateAgentActions([
    { ...meal, payload: { ...meal.payload, type: 'discard' } },
    { ...production, payload: { ...production.payload, production: { ...production.payload.production, eaten_servings: 0 } } },
  ], before);
  assert.equal(discarded.payload.recorded_at, undefined);
  assert.equal((uneaten.payload.production as Record<string, unknown>).eaten_at, undefined);
  const explicit = {actionType:'record_diet_meal',summary:'补录',payload:{foodName:'米饭',mealType:'晚餐',amount:'1份',recordedAt:'2026-12-30',recordedTime:'18:30'}};
  assert.equal(validateAgentActions([explicit], before)[0].payload.recordedAt, '2026-12-30');
  assert.equal(validateAgentActions([explicit], before)[0].payload.recordedTime, '18:30');
  const legacy = {...before, clock:undefined};
  assert.equal(validateAgentActions([{...explicit,payload:{...explicit.payload,recordedAt:'今天'}}], legacy)[0].payload.recordedAt, undefined);
});
