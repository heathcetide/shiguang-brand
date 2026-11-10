import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AgentOperationsRepository } from "../src/modules/agentOperations/repository.js";
import type { RecommendationsService } from "../src/modules/recommendations/service.js";

export async function verifyAgentRecipePreference(operations: AgentOperationsRepository,recommendations: RecommendationsService,
  query: (sql: string,values: unknown[]) => Promise<unknown>,userId: number,recipeId: number) {
  const runId = randomUUID();
  await query("INSERT INTO agent_runs(id,user_id,session_id,modality,status,input_json,checkpoint_thread_id) VALUES(?,?,'recipe-preference','text','running','{}',?)",[runId,userId,runId]);
  const create = async (version: number,value: 'dislike'|'neutral',id = randomUUID()) => {
    await query("INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key) VALUES(?,?,?,'update_recipe_preference','high','awaiting_approval','{}',?)",[id,runId,userId,id]);
    return { id,actionType: 'update_recipe_preference' as const,riskLevel: 'high' as const,summary: '明确长期菜谱口味',payload: { scope: 'persistent',recipeId,version,value } };
  };
  const initial = await recommendations.learningState(userId);
  const proposal = await create(initial.version,'dislike');
  const saved = await operations.executeActions(userId,runId,[proposal]);
  assert.deepEqual(await operations.executeActions(userId,runId,[proposal]),saved);
  const state = await recommendations.learningState(userId);
  assert.equal(state.version,initial.version+1);
  const item = state.items.find(item => item.recipeId===recipeId)!;
  assert.equal(item.origin,'explicit'); assert.equal(item.evidence[0]?.id,`preference-statement:${proposal.id}`);
  assert.equal(state.enabled,initial.enabled);
  const stale = await create(initial.version,'neutral');
  await assert.rejects(() => operations.executeActions(userId,runId,[stale]),/偏好已更新/);
  assert.equal((await recommendations.learningState(userId)).version,state.version);
  const corrected = await recommendations.updateLearning(userId,{ kind: 'recipe',version: state.version,recipeId,value: 'neutral' });
  assert.ok(!corrected.items.some(item => item.recipeId===recipeId));
  await operations.executeActions(userId,runId,[proposal]);
  assert.ok(!(await recommendations.learningState(userId)).items.some(item => item.recipeId===recipeId));
  await assert.rejects(() => operations.executeActions(-1,runId,[proposal]),/不存在|无权|不再允许/);
  const beforeRace = await recommendations.learningState(userId);
  const first = await create(beforeRace.version,'dislike');
  const second = await create(beforeRace.version,'neutral');
  const race = await Promise.allSettled([operations.executeActions(userId,runId,[first]),operations.executeActions(userId,runId,[second])]);
  assert.equal(race.filter(result => result.status==='fulfilled').length,1);
  assert.equal((await recommendations.learningState(userId)).version,beforeRace.version+1);
  await recommendations.updateLearning(userId,{ kind: 'recipe',version: beforeRace.version+1,recipeId,value: 'neutral' });
}
