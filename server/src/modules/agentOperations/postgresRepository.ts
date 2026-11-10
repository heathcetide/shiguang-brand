import { learningOverrides } from "../recommendations/preferenceEvidence.js";
import { lockMealPlanning } from "../mealPlans/postgresLock.js";
import { PostgresMealPlansRepository } from "../mealPlans/postgresRepository.js";
import { permanentRecipePreferencePayloadSchema, permanentPreferencePayloadSchema } from "../../services/agent/preferencePayload.js";
import { PostgresDietRecordsRepository } from "../dietRecords/postgresRepository.js";
import { agentMealProduction, agentPreparedMealEvent } from "../../services/agent/mealPayload.js";
import { agentInventoryCreate, agentInventoryUpdate, agentInventoryConsumption } from "../../services/agent/inventoryPayload.js";
import { PostgresInventoryRepository, consumeInventoryWithPostgresClient } from "../inventory/postgresRepository.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { inventoryUndoOrder, InventoryUndoVersions, inventoryUndoFields, arrayValue, nonNegativeInteger, nonNegativeNumber, reversibleAgentActions, stringValue, timestampMs } from "./helpers.js";
import type { AgentOperationsRepository, ExecutableAgentAction } from "./repository.js";

type PgActionRow = {
  id: string;
  action_type: string;
  status: string;
  before_json: unknown;
  result_json: unknown;
  executed_at: string | Date | null;
  created_at: string | Date;
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export class PostgresAgentOperationsRepository implements AgentOperationsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async executeActions(userId: number, runId: string, proposals: ExecutableAgentAction[]) {
    try {
      return await this.transaction(async (client) => {
      await lockMealPlanning(client,userId);
        const run = await client.query("SELECT status FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE", [runId, userId]);
        if (!run.rows[0] || run.rows[0].status !== "running") throw new Error("Agent Run 已取消或不再允许执行操作");
        const executions = [];
        for (const proposal of proposals) {
          executions.push({ actionId: proposal.id, result: await this.executeAction(client, userId, runId, proposal) });
        }
        return executions;
      });
    } catch (error) {
      const ids = proposals.flatMap((proposal) => proposal.id ? [proposal.id] : []);
      if (ids.length) {
        await this.pool.query(`UPDATE agent_actions SET status='failed',result_json=$1,updated_at=CURRENT_TIMESTAMP
          WHERE id=ANY($2::text[]) AND user_id=$3 AND run_id=$4 AND status IN ('proposed','awaiting_approval')`,
        [JSON.stringify({ error: error instanceof Error ? error.message : "执行失败" }), ids, userId, runId]);
      }
      throw error;
    }
  }

  async undoActions(userId: number, runId: string) {
    return this.transaction(async (client) => {
      await lockMealPlanning(client,userId);
      const selected = await client.query<PgActionRow>(`SELECT id,action_type,status,before_json,result_json,executed_at,created_at
        FROM agent_actions WHERE run_id=$1 AND user_id=$2 AND status IN ('executed','undone')
        ORDER BY created_at,id FOR UPDATE`, [runId, userId]);
      const actions = selected.rows.filter((row) => row.status === "executed" && reversibleAgentActions.has(row.action_type));
      if (!actions.length) {
        if (selected.rows.some(row => row.status === "undone" && reversibleAgentActions.has(row.action_type))) return { undone: 0 };
        throw new Error("没有可撤销的 Agent 操作");
      }
      const latest = Math.max(...actions.map((action) => timestampMs(action.executed_at || action.created_at)));
      if (!Number.isFinite(latest) || Date.now() - latest > 10 * 60_000) throw new Error("撤销窗口已过期");
      const undoVersions = new InventoryUndoVersions();
      for (const action of inventoryUndoOrder(actions)) {
        const result = objectValue(action.result_json);
        const before = objectValue(action.before_json);
        if ((action.action_type === "add_inventory_item" || action.action_type === "update_inventory_item") && result?.inventoryItemId) {
          const item = objectValue(result.item);
          if (!item?.version) throw new Error("库存操作缺少版本证据，无法安全撤销");
          const current = (await client.query("SELECT * FROM inventory_items WHERE id=$1 AND user_id=$2 AND version=$3 AND deleted_at IS NULL FOR UPDATE",
            [result.inventoryItemId,userId,undoVersions.expected(result.inventoryItemId, item.version)])).rows[0];
          if (!current) throw new Error("库存已有后续消耗或修改，请在库存页纠正，无法安全撤销");
          if (action.action_type === "add_inventory_item") {
            await client.query("UPDATE inventory_items SET deleted_at=CURRENT_TIMESTAMP,is_available=FALSE,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2",
              [result.inventoryItemId,userId]);
          } else {
            if (!before || before.id !== result.inventoryItemId) throw new Error("缺少库存原始状态，无法撤销");
            await client.query(`UPDATE inventory_items SET ${inventoryUndoFields.map((field,index) => `${field}=$${index+1}`).join(",")},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$13 AND user_id=$14`,
              [...inventoryUndoFields.map(field => before[field] ?? null),result.inventoryItemId,userId]);
          }
          if (action.action_type === "update_inventory_item") undoVersions.restored(result.inventoryItemId, current.version, before?.version);
          await client.query(`INSERT INTO inventory_change_logs(user_id,inventory_item_id,action,source,quantity_before,quantity_after,quantity_unit,idempotency_key,metadata_json)
            VALUES($1,$2,'undo','ai',$3,$4,$5,$6,$7)`, [userId,result.inventoryItemId,current.quantity_value,
            action.action_type === "add_inventory_item" ? null : before?.quantity_value ?? null,current.quantity_unit,
            `agent-undo:${action.id}`,JSON.stringify({ actionId: action.id, runId, actionType: action.action_type })]);
        } else if (action.action_type === "create_meal_plan" && result?.planId) {
          await new PostgresMealPlansRepository(this.pool).assertPlanEditWithClient(client,userId,String(result.planId),{ archive: true });
          const changed = await client.query(`UPDATE meal_plans SET deleted_at=CURRENT_TIMESTAMP,status='cancelled',version=version+1
            WHERE id=$1 AND user_id=$2 AND created_by_run_id=$3 AND version=1 AND deleted_at IS NULL`, [result.planId, userId, runId]);
          if (changed.rowCount !== 1) throw new Error("餐单已在 Agent 执行后发生变化，无法安全撤销");
        } else if (action.action_type === "add_shopping_items" && Array.isArray(result?.itemIds)) {
          for (const id of result.itemIds) {
            const changed = await client.query(`UPDATE shopping_list_items SET deleted_at=CURRENT_TIMESTAMP,version=version+1
              WHERE id=$1 AND user_id=$2 AND source_run_id=$3 AND version=1 AND deleted_at IS NULL`, [id, userId, runId]);
            if (changed.rowCount !== 1) throw new Error("采购项已在 Agent 执行后发生变化，无法安全撤销");
          }
        } else if (action.action_type === "update_shopping_item" && before?.id) {
          const changed = await client.query(`UPDATE shopping_list_items SET name=$1,amount=$2,category=$3,checked=$4,purchase_date=$5,
            storage_location=$6,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$7 AND user_id=$8 AND version=$9`,
          [before.name, before.amount, before.category, before.checked, before.purchase_date, before.storage_location,
            before.id, userId, Number(before.version) + 1]);
          if (changed.rowCount !== 1) throw new Error("采购项已在 Agent 执行后发生变化，无法安全撤销");
        } else if (action.action_type === "update_meal_plan" && before?.id) {
          await new PostgresMealPlansRepository(this.pool).assertPlanEditWithClient(client,userId,String(before.id),{ startDate: String(before.start_date),endDate: String(before.end_date),status: String(before.status),constraints: before.constraints_json });
          const changed = await client.query(`UPDATE meal_plans SET title=$1,start_date=$2,end_date=$3,status=$4,constraints_json=$5,
            version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND user_id=$7 AND version=$8`,
          [before.title, before.start_date, before.end_date, before.status, before.constraints_json,
            before.id, userId, Number(before.version) + 1]);
          if (changed.rowCount !== 1) throw new Error("餐单已在 Agent 执行后发生变化，无法安全撤销");
        } else {
          throw new Error(`操作 ${action.action_type} 不支持自动撤销`);
        }
        await this.updateActionStatus(client, action.id, userId, runId, "undone");
      }
      return { undone: actions.length };
    });
  }

  private async executeAction(client: PoolClient, userId: number, runId: string, action: ExecutableAgentAction) {
    if (!action.id) throw new Error("缺少 Agent Action ID");
    const selected = await client.query<{ status: string; result_json: unknown; action_type: string }>(`SELECT status,result_json,action_type FROM agent_actions
      WHERE id=$1 AND user_id=$2 AND run_id=$3 FOR UPDATE`, [action.id, userId, runId]);
    const existing = selected.rows[0];
    if (!existing) throw new Error("Agent 操作不存在或无权执行");
    if (existing.action_type !== action.actionType) throw new Error("Agent 操作类型与已保存提案不一致");
    if (existing.status === "executed") return existing.result_json || {};
    if (!new Set(["proposed", "awaiting_approval"]).has(existing.status)) throw new Error("Agent 操作当前状态不允许执行");
    const payload = action.payload;
    let before: unknown;
    let result: unknown;

    switch (action.actionType) {
      case "create_meal_plan": {
        const planId = randomUUID();
        const title = stringValue(payload.title, "AI 饮食计划").slice(0, 120);
        const startDate = stringValue(payload.startDate, currentDateKey());
        const endDate = stringValue(payload.endDate, startDate);
        await client.query(`INSERT INTO meal_plans
          (id,user_id,title,start_date,end_date,status,constraints_json,created_by_run_id)
          VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`, [planId, userId, title, startDate, endDate, payload.constraints || {}, runId]);
        const items = arrayValue(payload.items).slice(0, 70) as Array<Record<string, unknown>>;
        for (const item of items) {
          await client.query(`INSERT INTO meal_plan_items
            (id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json,calories,protein,carbs,fat)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
            randomUUID(), planId, userId, stringValue(item.date, startDate), stringValue(item.mealType, "晚餐"),
            stringValue(item.title, "健康餐"), Number.isInteger(Number(item.recipeId)) ? Number(item.recipeId) : null,
            JSON.stringify(arrayValue(item.ingredients)), JSON.stringify(arrayValue(item.steps)), nonNegativeNumber(item.calories), nonNegativeNumber(item.protein),
            nonNegativeNumber(item.carbs), nonNegativeNumber(item.fat),
          ]);
        }
        result = { planId, title, itemCount: items.length };
        break;
      }
      case "update_meal_plan": {
        const planId = stringValue(payload.planId);
        const selectedPlan = await client.query(`SELECT * FROM meal_plans WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE`, [planId, userId]);
        before = selectedPlan.rows[0];
        if (!before) throw new Error("餐单不存在或无权修改");
        await new PostgresMealPlansRepository(this.pool).assertPlanEditWithClient(client,userId,planId,{ startDate: payload.startDate ? stringValue(payload.startDate) : undefined,endDate: payload.endDate ? stringValue(payload.endDate) : undefined,constraints: payload.constraints });
        await client.query(`UPDATE meal_plans SET title=COALESCE($1,title),start_date=COALESCE($2,start_date),
          end_date=COALESCE($3,end_date),constraints_json=COALESCE($4,constraints_json),version=version+1,
          updated_at=CURRENT_TIMESTAMP WHERE id=$5 AND user_id=$6`, [
          payload.title ? stringValue(payload.title).slice(0, 120) : null, payload.startDate ? stringValue(payload.startDate) : null,
          payload.endDate ? stringValue(payload.endDate) : null, payload.constraints || null, planId, userId,
        ]);
        result = { planId };
        break;
      }
      case "add_shopping_items": {
        const ids: string[] = [];
        for (const item of arrayValue(payload.items).slice(0, 100) as Array<Record<string, unknown>>) {
          const name = stringValue(item.name);
          if (!name) continue;
          const id = randomUUID();
          await client.query(`INSERT INTO shopping_list_items
            (id,user_id,client_id,name,amount,category,purchase_date,storage_location,source_run_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
            id, userId, item.clientId ? stringValue(item.clientId) : null, name.slice(0, 120),
            stringValue(item.amount, "适量").slice(0, 80), stringValue(item.category, "其他").slice(0, 40),
            item.purchaseDate ? stringValue(item.purchaseDate) : null,
            item.storageLocation ? stringValue(item.storageLocation) : null, runId,
          ]);
          ids.push(id);
        }
        result = { itemIds: ids, count: ids.length };
        break;
      }
      case "update_shopping_item": {
        const itemId = stringValue(payload.itemId);
        const selectedItem = await client.query(`SELECT * FROM shopping_list_items
          WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE`, [itemId, userId]);
        before = selectedItem.rows[0];
        if (!before) throw new Error("采购项不存在或无权修改");
        await client.query(`UPDATE shopping_list_items SET name=COALESCE($1,name),amount=COALESCE($2,amount),
          category=COALESCE($3,category),checked=COALESCE($4,checked),purchase_date=COALESCE($5,purchase_date),
          storage_location=COALESCE($6,storage_location),version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$7 AND user_id=$8`, [
          payload.name ? stringValue(payload.name).slice(0, 120) : null, payload.amount ? stringValue(payload.amount).slice(0, 80) : null,
          payload.category ? stringValue(payload.category).slice(0, 40) : null, typeof payload.checked === "boolean" ? payload.checked : null,
          payload.purchaseDate ? stringValue(payload.purchaseDate) : null,
          payload.storageLocation ? stringValue(payload.storageLocation) : null, itemId, userId,
        ]);
        result = { itemId };
        break;
      }
      case "delete_meal_plan": {
        const planId = stringValue(payload.planId);
        const selectedPlan = await client.query(`SELECT * FROM meal_plans WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE`, [planId, userId]);
        before = selectedPlan.rows[0];
        if (!before) throw new Error("餐单不存在或无权删除");
        await client.query(`UPDATE meal_plans SET deleted_at=CURRENT_TIMESTAMP,status='cancelled',updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND user_id=$2`, [planId, userId]);
        result = { planId };
        break;
      }
      case "delete_shopping_item": {
        const itemId = stringValue(payload.itemId);
        const selectedItem = await client.query(`SELECT * FROM shopping_list_items
          WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE`, [itemId, userId]);
        before = selectedItem.rows[0];
        if (!before) throw new Error("采购项不存在或无权删除");
        await client.query(`UPDATE shopping_list_items SET deleted_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND user_id=$2`, [itemId, userId]);
        result = { itemId };
        break;
      }
      case "produce_meal": {
        const input = agentMealProduction(payload, `agent-production:${action.id}`);
        result = await new PostgresDietRecordsRepository(this.pool, consumeInventoryWithPostgresClient).completeCookingWithClient(client, userId, input);
        break;
      }
      case "record_prepared_meal_event": {
        const { mealId, input } = agentPreparedMealEvent(payload, `agent-meal-event:${action.id}`);
        result = await new PostgresDietRecordsRepository(this.pool, consumeInventoryWithPostgresClient).applyMealEventWithClient(client, userId, mealId, input);
        break;
      }
      case "record_diet_meal": {
        const foodName = stringValue(payload.foodName);
        if (!foodName) throw new Error("缺少食物名称");
        const recordedAt = stringValue(payload.recordedAt, currentDateKey());
        const inserted = await client.query<{ id: number }>(`INSERT INTO diet_records
          (user_id,meal_type,food_name,amount,calories,protein,carbs,fat,recorded_at,recorded_time)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [
          userId, stringValue(payload.mealType, "午餐"), foodName, stringValue(payload.amount, "1份"),
          nonNegativeInteger(payload.calories), nonNegativeNumber(payload.protein), nonNegativeNumber(payload.carbs),
          nonNegativeNumber(payload.fat), recordedAt,
          payload.recordedTime ? stringValue(payload.recordedTime) : recordedAt === currentDateKey() ? currentTimeKey() : null,
        ]);
        result = { dietRecordId: Number(inserted.rows[0].id) };
        break;
      }
      case "add_inventory_item": {
        const inventory = new PostgresInventoryRepository(this.pool);
        const input = agentInventoryCreate(payload);
        const item = await inventory.createWithClient(client, userId, input, "ai");
        result = { inventoryItemId: item.id, item };
        break;
      }
      case "update_inventory_item": {
        const inventory = new PostgresInventoryRepository(this.pool);
        const { itemId, version, patch } = agentInventoryUpdate(payload);
        const current = (await client.query("SELECT * FROM inventory_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [itemId, userId])).rows[0];
        if (!current) throw new Error("库存食材不存在或无权修改");
        before = current;
        const hasQuantity = Object.prototype.hasOwnProperty.call(patch, "quantity_value");
        const persistence = {
          patch,
          nextQuantityValue: hasQuantity ? patch.quantity_value ?? null : current.quantity_value == null ? null : Number(current.quantity_value),
          nextQuantityUnit: hasQuantity ? patch.quantity_unit ?? null : current.quantity_unit as typeof patch.quantity_unit ?? null,
        };
        const updated = await inventory.updateWithClient(client, userId, itemId, version, persistence, "ai");
        if (updated.kind === "conflict") throw new Error("库存已在其他设备更新，请刷新后重试");
        result = { inventoryItemId: itemId, item: updated.item };
        break;
      }
      case "consume_inventory_items": {

        const { input, reason } = agentInventoryConsumption(payload, `agent-inventory:${runId}:${action.id}`);
        const consumed = await consumeInventoryWithPostgresClient(client, userId, input, { reason, runId });
        result = { inventoryItemIds: input.items.map(item => item.item_id), ...consumed, reason };
        break;
      }
      case "update_recipe_preference": {
        const input = permanentRecipePreferencePayloadSchema.parse(payload);
        const recipe = await client.query("SELECT id FROM recipes WHERE id=$1 AND status='approved' AND deleted_at IS NULL FOR SHARE",[input.recipeId]);
        if (!recipe.rows[0]) throw new Error("菜谱不存在或不可设置偏好");
        await client.query("INSERT INTO recommendation_learning_settings(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[userId]);
        const stored = (await client.query("SELECT * FROM recommendation_learning_settings WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];
        if (Number(stored.version)!==input.version) throw new Error("偏好已更新，请重新核对提案");
        const overrides = learningOverrides(stored);
        before = { version: Number(stored.version),preference: overrides[String(input.recipeId)] ?? null };
        overrides[String(input.recipeId)] = { value: input.value,updatedAt: new Date().toISOString(),sourceActionId: action.id! };
        await client.query("UPDATE recommendation_learning_settings SET overrides_json=$1::jsonb,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$2",[JSON.stringify(overrides),userId]);
        result = { recipeId: input.recipeId,value: input.value,version: input.version+1,scope: "persistent" };
        break;
      }
      case "update_kitchen_preferences": {
        const { preferences } = permanentPreferencePayloadSchema.parse(payload);
        await client.query("INSERT INTO user_health_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING", [userId]);
        const stored = (await client.query("SELECT kitchen_constraints_json FROM user_health_profiles WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
        before = objectValue(stored.kitchen_constraints_json) || {};
        const effective = { ...(before as Record<string, unknown>), ...preferences };
        await client.query("UPDATE user_health_profiles SET kitchen_constraints_json=$1::jsonb,updated_at=CURRENT_TIMESTAMP WHERE user_id=$2", [JSON.stringify(effective),userId]);
        result = { kitchenPreferences: effective, scope: "persistent" };
        break;
      }
      case "add_kitchenware_item": {
        const name = stringValue(payload.name);
        if (!name) throw new Error("缺少厨具名称");
        const inserted = await client.query<{ id: number }>(`INSERT INTO kitchenware_items (user_id,name,category,status,note)
          VALUES ($1,$2,$3,$4,$5) RETURNING id`, [userId, name, stringValue(payload.category, "其他"),
          stringValue(payload.status, "良好"), stringValue(payload.note).slice(0, 300) || null]);
        result = { kitchenwareItemId: Number(inserted.rows[0].id) };
        break;
      }
      case "submit_recipe": {
        const title = stringValue(payload.title);
        if (!title) throw new Error("缺少菜谱标题");
        const inserted = await client.query<{ id: number }>(`INSERT INTO recipes
          (title,description,cook_time,difficulty,calories,protein,carbs,fat,category,tags,steps_json,ingredients_json,source,status,author_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ai','pending',$13) RETURNING id`, [
          title, stringValue(payload.description), nonNegativeInteger(payload.cookTime) || 0, stringValue(payload.difficulty, "简单"),
          nonNegativeInteger(payload.calories) || 0, nonNegativeNumber(payload.protein) || 0, nonNegativeNumber(payload.carbs) || 0,
          nonNegativeNumber(payload.fat) || 0, stringValue(payload.category, "其他"), JSON.stringify(arrayValue(payload.tags)),
          JSON.stringify(arrayValue(payload.steps)), JSON.stringify(arrayValue(payload.ingredients)), userId,
        ]);
        result = { recipeId: Number(inserted.rows[0].id), status: "pending" };
        break;
      }
      case "record_health_log": {
        const values = [nonNegativeNumber(payload.weightKg), nonNegativeNumber(payload.bodyFatPercentage), nonNegativeInteger(payload.waterMl)];
        if (values.every((value) => value === null)) throw new Error("缺少可记录的健康数据");
        const inserted = await client.query<{ id: number }>(`INSERT INTO health_logs (user_id,weight,body_fat,water_ml,recorded_date)
          VALUES ($1,$2,$3,$4,$5) RETURNING id`, [userId, values[0], values[1], values[2], stringValue(payload.recordedDate, currentDateKey())]);
        result = { healthLogId: Number(inserted.rows[0].id) };
        break;
      }
      default:
        throw new Error(`不支持的 Agent 操作：${action.actionType}`);
    }

    await this.updateActionStatus(client, action.id, userId, runId, "executed", before, result);
    return result;
  }

  private async updateActionStatus(client: PoolClient, id: string, userId: number, runId: string,
    status: "executed" | "undone", before?: unknown, result?: unknown) {
    await client.query(`UPDATE agent_actions SET status=$1,before_json=COALESCE($2,before_json),result_json=COALESCE($3,result_json),
      executed_at=CASE WHEN $1='executed' THEN CURRENT_TIMESTAMP ELSE executed_at END,
      undone_at=CASE WHEN $1='undone' THEN CURRENT_TIMESTAMP ELSE undone_at END,updated_at=CURRENT_TIMESTAMP
      WHERE id=$4 AND user_id=$5 AND run_id=$6`, [status,
      before === undefined ? null : JSON.stringify(before), result === undefined ? null : JSON.stringify(result), id, userId, runId]);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
