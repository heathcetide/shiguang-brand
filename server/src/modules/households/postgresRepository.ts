import { readPostgresDiningSupply } from "./postgresDiningSupply.js";
import { diningNetShopping } from "./diningNetShopping.js";
import { householdDiningSupplySchema } from "@dietdigidose/contracts";
import { diningSupply } from "./diningSupply.js";
import { validatePostgresDiningPlan } from "./postgresDiningPlan.js";
import { appendPostgresMaintenanceEvent } from "../planMaintenance/postgresEventWriter.js";
import { lockMealPlanning } from "../mealPlans/postgresLock.js";
import { reservationTotals, validateReservation } from "./reservations.js";
import { eatingRequest, prepareEating, repeatEating } from "./eating.js";
import { randomUUID } from "node:crypto";
import { HouseholdsError } from "./errors.js";
import { validateProductionPlan, consumeProductionItem, productionRequest, productionResult, repeatProduction } from "./production.js";
import type { Pool, PoolClient } from "pg";
import type { HouseholdsRepository } from "./repository.js";
import type {
  IntakeResult, InventoryCreateInput, InventoryUpdateInput, Row, ShoppingCreateInput, ShoppingIntakeInput, ShoppingUpdateInput,
} from "./types.js";

const shoppingSelect = `SELECT hs.*,
  COALESCE(creator.nickname,creator.username) AS creator_name,
  COALESCE(editor.nickname,editor.username) AS updater_name,
  COALESCE(buyer.nickname,buyer.username) AS purchaser_name
  FROM household_shopping_items hs JOIN users creator ON creator.id=hs.created_by_user_id
  JOIN users editor ON editor.id=hs.updated_by_user_id LEFT JOIN users buyer ON buyer.id=hs.purchased_by_user_id`;
const inventorySelect = `SELECT hi.*,COALESCE(u.nickname,u.username) AS creator_name FROM household_inventory_items hi
  LEFT JOIN users u ON hi.created_by_user_id=u.id`;

function json<T>(value: unknown): T {
  if (typeof value !== "string") return value as T;
  return JSON.parse(value) as T;
}

export class PostgresHouseholdsRepository implements HouseholdsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async diningSupply(userId: number,householdId: number,target: { planId: string; itemId: string; version: number },totalServings: number,recipeFingerprint: string) {
    return this.tx(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      if (!await this.member(client,householdId,userId)) throw new HouseholdsError(403,"你不是该家庭的成员","NOT_MEMBER");
      const snapshot = await readPostgresDiningSupply(client,userId,householdId,target,totalServings,recipeFingerprint);
      return householdDiningSupplySchema.parse({ ...diningSupply(snapshot),netShopping: diningNetShopping(snapshot) });
    });
  }

  async diningPlanContext(userId: number,planId: string,itemId: string) {
    return this.tx(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      const item = (await client.query("SELECT i.* FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.id=$1 AND i.plan_id=$2 AND i.user_id=$3 AND p.user_id=$3 AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active'",[itemId,planId,userId])).rows[0] as Row | undefined;
      if (!item) return null;
      const queue = item.queue_item_id ? (await client.query("SELECT id,version,status FROM cooking_queue_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",[item.queue_item_id,userId])).rows[0] as Row | undefined : undefined;
      const purchases = (await client.query("SELECT id,version,checked FROM shopping_list_items WHERE user_id=$1 AND client_id LIKE $2 ORDER BY id",[userId,`meal-plan:${item.id}:%`])).rows as Row[];
    const sharedPurchases = (await client.query("SELECT id,version,(checked OR transferred_at IS NOT NULL) AS checked FROM household_shopping_items WHERE source_plan_item_id=$1 ORDER BY id",[item.id])).rows as Row[];
    purchases.push(...sharedPurchases.map(row => ({ ...row,id: `household:${row.id}` })));
      return { item,queue,purchases };
    });
  }
  async reserveMeal(userId: number,householdId: number,mealId: string,input: import("@dietdigidose/contracts").HouseholdMealReservationInput) {
    return this.tx(async client => {
      const member = await this.member(client,householdId,userId,true);
      if (!member || Number(member.id) !== input.membershipId) throw new HouseholdsError(403,"家庭成员身份已变化，请重新读取","NOT_MEMBER");
      const meal = (await client.query("SELECT * FROM household_meal_batches WHERE id=$1 AND household_id=$2 FOR UPDATE",[mealId,householdId])).rows[0] as Row | undefined;
      if (!meal) throw new HouseholdsError(404,"家庭批次不存在","MEAL_NOT_FOUND");
      const totals = reservationTotals((await client.query("SELECT membership_id,servings FROM household_meal_reservations WHERE meal_id=$1",[mealId])).rows,input.membershipId);
      validateReservation(meal,input,totals);
      if (input.servings > 0) await client.query("INSERT INTO household_meal_reservations(meal_id,membership_id,servings) VALUES($1,$2,$3) ON CONFLICT(meal_id,membership_id) DO UPDATE SET servings=excluded.servings",[mealId,input.membershipId,input.servings]);
      else await client.query("DELETE FROM household_meal_reservations WHERE meal_id=$1 AND membership_id=$2",[mealId,input.membershipId]);
      await client.query("UPDATE household_meal_batches SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1",[mealId]);
      return { version: input.version+1,myReservedServings: input.servings };
    });
  }
  async meals(userId: number,householdId: number) {
    return this.tx(async client => {
      const member = await this.member(client,householdId,userId,true);
      if (!member) throw new HouseholdsError(403,"你不是该家庭的成员","NOT_MEMBER");
      return (await client.query(`SELECT b.*,
        COALESCE((SELECT sum(servings) FROM household_meal_reservations WHERE meal_id=b.id),0) AS reserved_total,
        COALESCE((SELECT servings FROM household_meal_reservations WHERE meal_id=b.id AND membership_id=$2),0) AS reserved_mine
        FROM household_meal_batches b WHERE household_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[householdId,member!.id])).rows.map(row => productionResult(row,false));
    });
  }
  async eatMeal(userId: number,householdId: number,mealId: string,input: import("@dietdigidose/contracts").HouseholdMealEatingInput) {
    return this.tx(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`household-eat:${userId}:${input.idempotencyKey}`]);
      const member = await this.member(client,householdId,userId,true);
      if (!member || Number(member.id) !== input.membershipId) throw new HouseholdsError(403,"家庭成员身份已变化，请重新读取","NOT_MEMBER");
      const existing = (await client.query("SELECT * FROM household_meal_events WHERE user_id=$1 AND idempotency_key=$2",[userId,input.idempotencyKey])).rows[0] as Row | undefined;
      if (existing) return repeatEating(existing,householdId,mealId,input);
      const meal = (await client.query("SELECT * FROM household_meal_batches WHERE id=$1 AND household_id=$2 FOR UPDATE",[mealId,householdId])).rows[0] as Row | undefined;
      if (!meal) throw new HouseholdsError(404,"家庭待吃餐不存在","MEAL_NOT_FOUND");
      const totals = reservationTotals((await client.query("SELECT membership_id,servings FROM household_meal_reservations WHERE meal_id=$1",[mealId])).rows,input.membershipId);
      const next = prepareEating(meal,input,totals); const record = next.record;
      const diet = (await client.query("INSERT INTO diet_records(user_id,food_name,meal_type,amount,calories,protein,carbs,fat,recorded_at,recorded_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [userId,record.food_name,record.meal_type,record.amount,record.calories ?? null,record.protein ?? null,record.carbs ?? null,record.fat ?? null,record.recorded_at,record.recorded_time])).rows[0];
      await client.query("UPDATE household_meal_batches SET remaining_servings=$1,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",[next.remaining,mealId]);
      if (next.reservedUsed > 0) {
        if (next.reservedUsed >= totals.mine) await client.query("DELETE FROM household_meal_reservations WHERE meal_id=$1 AND membership_id=$2",[mealId,input.membershipId]);
        else await client.query("UPDATE household_meal_reservations SET servings=$1 WHERE meal_id=$2 AND membership_id=$3",[Math.round((totals.mine-next.reservedUsed)*1_000_000)/1_000_000,mealId,input.membershipId]);
      }
      const result = { meal: productionResult({ ...meal,remaining_servings: next.remaining,version: input.version+1 },false),dietRecordId: Number(diet.id),repeated: false };
      await client.query("INSERT INTO household_meal_events(id,household_id,meal_id,user_id,membership_id,idempotency_key,servings,request_json,result_json,diet_record_id,reserved_servings_used) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)",
        [randomUUID(),householdId,mealId,userId,input.membershipId,input.idempotencyKey,input.servings,JSON.stringify(eatingRequest(input)),JSON.stringify(result),result.dietRecordId,next.reservedUsed]);
      return result;
    });
  }

  async produceMeal(userId: number, householdId: number, input: import("@dietdigidose/contracts").HouseholdMealProductionInput) {
    return this.tx(async client => {
      if (input.planItem) {
        await lockMealPlanning(client,userId);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`prepared-meals:${userId}`]);
      }
      await client.query("SELECT id FROM households WHERE id=$1 FOR UPDATE",[householdId]);
      const member = await this.member(client,householdId,userId,true);
      if (!member || Number(member.id) !== input.membershipId) throw new HouseholdsError(403,"家庭成员身份已变化，请重新读取","NOT_MEMBER");
      const existing = (await client.query("SELECT * FROM household_meal_batches WHERE household_id=$1 AND idempotency_key=$2",[householdId,input.idempotencyKey])).rows[0] as Row | undefined;
      if (existing) return repeatProduction(existing,userId,input);
      let dining: import("@dietdigidose/contracts").HouseholdDiningPlan | null = null;
      if (input.planItem) {
        const item = (await client.query("SELECT i.* FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.id=$1 AND i.plan_id=$2 AND i.user_id=$3 AND p.user_id=$3 AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' FOR UPDATE OF i,p",[input.planItem.itemId,input.planItem.planId,userId])).rows[0] as Row | undefined;
        validateProductionPlan(item,input);
        dining = item?.dining_json ? (typeof item.dining_json === "string" ? JSON.parse(item.dining_json) : item.dining_json) as import("@dietdigidose/contracts").HouseholdDiningPlan : null;
        if (dining) {
          if (dining.householdId !== householdId) throw new HouseholdsError(409,"共餐安排属于另一家庭，请回到原安排","DINING_HOUSEHOLD_CHANGED");
          await validatePostgresDiningPlan(client,userId,item?.recipe_id,dining);
        }
      }
      const snapshot: Row[] = [];
      for (const consumption of productionRequest(input).inventory) {
        const item = (await client.query("SELECT * FROM household_inventory_items WHERE id=$1 AND household_id=$2 FOR UPDATE",[consumption.itemId,householdId])).rows[0] as Row | undefined;
        if (!item) throw new HouseholdsError(409,"家庭原料不存在或不属于该家庭","INVENTORY_CONFLICT");
        const next = consumeProductionItem(item,consumption);
        await client.query("UPDATE household_inventory_items SET quantity=$1,is_available=$2,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND household_id=$4",
          [next.nextQuantity,next.available,consumption.itemId,householdId]);
        snapshot.push({ ...consumption,foodName: item.food_name,before: item.quantity,after: next.nextQuantity });
        await this.activity(client,householdId,userId,"consume",String(item.food_name),`${consumption.amount}${consumption.unit}`,String(item.storage_location));
      }
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO household_meal_batches(id,household_id,created_by_user_id,membership_id,idempotency_key,request_json,food_name,produced_servings,remaining_servings,inventory_json)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb) RETURNING *`,[id,householdId,userId,input.membershipId,input.idempotencyKey,JSON.stringify(productionRequest(input)),input.foodName,input.producedServings,input.producedServings,JSON.stringify(snapshot)])).rows[0] as Row;
      if (input.planItem) {
        await client.query("UPDATE household_meal_batches SET plan_item_id=$1,dining_json=$3::jsonb WHERE id=$2",[input.planItem.itemId,id,dining ? JSON.stringify(dining) : null]);
        await client.query("UPDATE meal_plan_items SET status='completed',completed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2",[input.planItem.itemId,userId]);
        await appendPostgresMaintenanceEvent(client,{ userId,kind: "cooking_completion",sourceId: `household:${id}`,subjectId: id,details: { planItemId: input.planItem.itemId,version: input.planItem.version+1,mode: "household" } });
      }
      return productionResult(row,false);
    });
  }

  async diningRecipe(recipeId: number) {
    return (await this.pool.query("SELECT id,title,description,ingredients_json,serving_size FROM recipes WHERE id=$1 AND deleted_at IS NULL AND status='approved' AND COALESCE(quality_status,'trusted') <> 'needs_review'",[recipeId])).rows[0] as Row | undefined ?? null;
  }

  async diningMembers(userId: number, householdId: number) {
    return (await this.pool.query(`SELECT hm.id,hm.user_id,COALESCE(u.nickname,u.username) AS name,hm.dining_shared,hm.dining_version,
      CASE WHEN hm.dining_shared=1 THEN hm.dining_preferences_json ELSE NULL END AS dining_preferences_json
      FROM household_members hm JOIN users u ON u.id=hm.user_id
      WHERE hm.household_id=$1 AND EXISTS (
        SELECT 1 FROM household_members viewer WHERE viewer.household_id=hm.household_id AND viewer.user_id=$2)
      ORDER BY hm.id`,[householdId,userId])).rows as Row[];
  }

  async diningPreferences(userId: number, householdId: number) {
    return (await this.pool.query("SELECT id,dining_shared,dining_preferences_json,dining_version FROM household_members WHERE household_id=$1 AND user_id=$2",[householdId,userId])).rows[0] as Row | undefined ?? null;
  }
  async saveDiningPreferences(userId: number, householdId: number, input: import("@dietdigidose/contracts").HouseholdDiningPreferencesInput) {
    return (await this.pool.query("UPDATE household_members SET dining_shared=$1,dining_preferences_json=$2::jsonb,dining_version=dining_version+1 WHERE household_id=$3 AND user_id=$4 AND dining_version=$5 AND id=$6",
      [Number(input.shared),JSON.stringify({ allergies: input.allergies,restrictions: input.restrictions }),householdId,userId,input.version,input.membershipId])).rowCount === 1;
  }

  async create(userId: number, name: string, inviteCode: string) {
    try {
      return await this.tx(async (client) => {
        const household = (await client.query("INSERT INTO households (name,invite_code,owner_id) VALUES ($1,$2,$3) RETURNING *",
        [name, inviteCode, userId])).rows[0] as Row;
        await client.query("INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$2,'owner')", [household.id, userId]);
        return household;
      });
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === "23505" && pgError.constraint === "households_invite_code_key") return null;
      throw error;
    }
  }

  async mine(userId: number) {
    const households = (await this.pool.query(`SELECT h.*,hm.role AS my_role FROM households h JOIN household_members hm
      ON h.id=hm.household_id WHERE hm.user_id=$1 ORDER BY h.created_at DESC`, [userId])).rows as Row[];
    return Promise.all(households.map(async (household) => ({ ...household, members: (await this.pool.query(`SELECT u.id AS user_id,
      u.username,COALESCE(u.nickname,u.username) AS nickname,u.avatar_url,hm.role,hm.joined_at FROM household_members hm
      JOIN users u ON hm.user_id=u.id WHERE hm.household_id=$1 ORDER BY hm.joined_at`, [household.id])).rows })));
  }

  async join(userId: number, inviteCode: string) {
    return this.tx(async (client) => {
      const household = (await client.query("SELECT * FROM households WHERE invite_code=$1", [inviteCode])).rows[0] as Row | undefined;
      if (!household) return { kind: "not_found" as const };
      const inserted = await client.query(`INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$2,'member')
        ON CONFLICT (household_id,user_id) DO NOTHING RETURNING id`, [household.id, userId]);
      return { kind: inserted.rowCount === 1 ? "joined" as const : "existing" as const, household };
    });
  }

  async leave(userId: number, householdId: number) {
    return this.tx(async (client) => {
      await client.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [householdId]);
      const member = (await client.query("SELECT * FROM household_members WHERE household_id=$1 AND user_id=$2 FOR UPDATE",
      [householdId, userId])).rows[0] as Row | undefined;
      if (!member) return { kind: "not_member" as const };
      if (member.role === "owner") {
        const next = (await client.query(`SELECT * FROM household_members WHERE household_id=$1 AND user_id<>$2
          ORDER BY id LIMIT 1 FOR UPDATE`, [householdId, userId])).rows[0] as Row | undefined;
        if (!next) {
          await client.query("DELETE FROM households WHERE id=$1", [householdId]);
          return { kind: "dissolved" as const };
        }
        await client.query("UPDATE household_members SET role='owner' WHERE id=$1", [next.id]);
        await client.query("UPDATE households SET owner_id=$1,version=version+1 WHERE id=$2", [next.user_id, householdId]);
        await client.query("DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", [householdId, userId]);
        await this.activity(client, householdId, userId, "owner_transfer_leave", "家庭所有者", "1次");
        return { kind: "transferred" as const, newOwnerUserId: Number(next.user_id) };
      }
      await client.query("DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", [householdId, userId]);
      return { kind: "left" as const };
    });
  }

  async transferOwner(userId: number, householdId: number, newOwnerUserId: number, version: number) {
    return this.tx(async (client) => {
      const household = (await client.query("SELECT * FROM households WHERE id=$1 AND owner_id=$2 FOR UPDATE", [householdId, userId]))
        .rows[0] as Row | undefined;
      if (!household) return { kind: "not_owner" as const };
      if (!await this.member(client, householdId, newOwnerUserId)) return { kind: "target_not_member" as const };
      const changed = await client.query(`UPDATE households SET owner_id=$1,version=version+1
        WHERE id=$2 AND owner_id=$3 AND version=$4`, [newOwnerUserId, householdId, userId, version]);
      if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
      await client.query("UPDATE household_members SET role='member' WHERE household_id=$1 AND user_id=$2", [householdId, userId]);
      await client.query("UPDATE household_members SET role='owner' WHERE household_id=$1 AND user_id=$2", [householdId, newOwnerUserId]);
      await this.activity(client, householdId, userId, "owner_transfer", "家庭所有者", "1次");
      return { kind: "transferred" as const, version: Number(household.version) + 1 };
    });
  }

  async shoppingList(userId: number, householdId: number) {
    if (!await this.member(this.pool, householdId, userId)) return null;
    return (await this.pool.query(`${shoppingSelect} WHERE hs.household_id=$1 AND hs.deleted_at IS NULL
      AND hs.transferred_at IS NULL ORDER BY hs.checked,hs.updated_at DESC`, [householdId])).rows as Row[];
  }

  async createShopping(userId: number, householdId: number, id: string, input: ShoppingCreateInput) {
    return this.tx(async (client) => {
      if (!await this.member(client, householdId, userId)) return { kind: "not_member" as const };
      const active = (await client.query(`SELECT id,name,amount,category FROM household_shopping_items
        WHERE household_id=$1 AND deleted_at IS NULL AND transferred_at IS NULL`, [householdId])).rows as Row[];
      await client.query(`INSERT INTO household_shopping_items
        (id,household_id,name,amount,category,storage_location,expiration_date,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [id, householdId, input.name, input.amount, input.category,
        input.storageLocation ?? null, input.expirationDate ?? null, userId]);
      await this.activity(client, householdId, userId, "shopping_add", input.name, input.amount, input.storageLocation);
      const item = (await client.query(`${shoppingSelect} WHERE hs.id=$1 AND hs.household_id=$2`, [id, householdId])).rows[0] as Row;
      return { kind: "created" as const, item, active };
    });
  }

  async updateShopping(userId: number, householdId: number, itemId: string, input: ShoppingUpdateInput) {
    return this.tx(async (client) => {
      if (!await this.member(client, householdId, userId)) return { kind: "not_member" as const };
      const current = (await client.query(`SELECT * FROM household_shopping_items WHERE id=$1 AND household_id=$2
        AND deleted_at IS NULL AND transferred_at IS NULL`, [itemId, householdId])).rows[0] as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      const checked = input.checked === undefined ? Boolean(current.checked) : input.checked;
      const purchasedBy = checked ? (input.checked === true ? userId : current.purchased_by_user_id) : null;
      const changed = await client.query(`UPDATE household_shopping_items SET name=$1,amount=$2,category=$3,checked=$4,
        storage_location=$5,expiration_date=$6,updated_by_user_id=$7,purchased_by_user_id=$8,version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=$9 AND household_id=$10 AND version=$11 AND deleted_at IS NULL AND transferred_at IS NULL`, [
        input.name ?? current.name, input.amount ?? current.amount, input.category ?? current.category, checked,
        input.storageLocation ?? current.storage_location, input.expirationDate ?? current.expiration_date, userId, purchasedBy,
        itemId, householdId, input.version,
      ]);
      if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
      await this.activity(client, householdId, userId, input.checked === undefined ? "shopping_edit" : checked ? "shopping_purchase" : "shopping_uncheck",
        input.name ?? String(current.name), input.amount ?? String(current.amount), input.storageLocation ?? String(current.storage_location || ""));
      const item = (await client.query(`${shoppingSelect} WHERE hs.id=$1 AND hs.household_id=$2`, [itemId, householdId])).rows[0] as Row;
      return { kind: "updated" as const, item };
    });
  }

  async removeShopping(userId: number, householdId: number, itemId: string, version: number) {
    return this.tx(async (client) => {
      if (!await this.member(client, householdId, userId)) return "not_member" as const;
      const item = (await client.query(`SELECT * FROM household_shopping_items WHERE id=$1 AND household_id=$2
        AND deleted_at IS NULL AND transferred_at IS NULL`, [itemId, householdId])).rows[0] as Row | undefined;
      if (!item) return "not_found" as const;
      const changed = await client.query(`UPDATE household_shopping_items SET deleted_at=CURRENT_TIMESTAMP,
        updated_by_user_id=$1,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND household_id=$3 AND version=$4
        AND deleted_at IS NULL AND transferred_at IS NULL`, [userId, itemId, householdId, version]);
      if (changed.rowCount !== 1) return "version_conflict" as const;
      await this.activity(client, householdId, userId, "shopping_delete", String(item.name), String(item.amount), String(item.storage_location || ""));
      return "deleted" as const;
    });
  }

  async intake(userId: number, householdId: number, batchId: string, input: ShoppingIntakeInput) {
    try {
      return await this.tx(async (client) => {
      await client.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [householdId]);
      if (!await this.member(client, householdId, userId)) return { kind: "not_member" as const };
      const saved = (await client.query(`SELECT result_json FROM household_shopping_intake_batches
        WHERE household_id=$1 AND idempotency_key=$2`, [householdId, input.idempotencyKey])).rows[0] as Row | undefined;
      if (saved) return { kind: "repeated" as const, value: { ...json<IntakeResult>(saved.result_json), repeated: true } };
      const confirmedItems: Array<{ confirmed: ShoppingIntakeInput["items"][number]; item: Row }> = [];
      for (const confirmed of input.items) {
        const item = (await client.query(`SELECT * FROM household_shopping_items WHERE id=$1 AND household_id=$2
          AND checked=TRUE AND deleted_at IS NULL AND transferred_at IS NULL FOR UPDATE`, [confirmed.id, householdId])).rows[0] as Row | undefined;
        if (!item || Number(item.version) !== confirmed.version) return { kind: "version_conflict" as const };
        confirmedItems.push({ confirmed, item });
      }
      const inventoryIds: number[] = [];
      for (const { confirmed, item } of confirmedItems) {
        const inserted = await client.query(`INSERT INTO household_inventory_items
          (household_id,created_by_user_id,food_name,category,quantity,expiration_date,storage_location,image_url,is_available)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,TRUE) RETURNING id`, [householdId, userId, item.name, item.category,
        confirmed.quantity, confirmed.expirationDate, confirmed.storageLocation]);
        inventoryIds.push(Number(inserted.rows[0]!.id));
        const moved = await client.query(`UPDATE household_shopping_items SET transferred_at=CURRENT_TIMESTAMP,intake_batch_id=$1,
          updated_by_user_id=$2,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND household_id=$4 AND version=$5
          AND transferred_at IS NULL`, [batchId, userId, item.id, householdId, confirmed.version]);
        if (moved.rowCount !== 1) throw new Error("HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
        await this.activity(client, householdId, userId, "shopping_intake", String(item.name), confirmed.quantity, confirmed.storageLocation);
      }
      const value: IntakeResult = { batchId, inventoryIds, count: inventoryIds.length, repeated: false };
      await client.query(`INSERT INTO household_shopping_intake_batches
        (id,household_id,user_id,idempotency_key,result_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [batchId, householdId, userId, input.idempotencyKey, JSON.stringify(value)]);
      return { kind: "created" as const, value };
      });
    } catch (error) {
      if (error instanceof Error && error.message === "HOUSEHOLD_SHOPPING_VERSION_CONFLICT") return { kind: "version_conflict" as const };
      throw error;
    }
  }

  async inventory(userId: number, householdId: number) {
    if (!await this.member(this.pool, householdId, userId)) return null;
    return (await this.pool.query(`${inventorySelect} WHERE hi.household_id=$1 AND hi.is_available=TRUE ORDER BY hi.expiration_date`,
    [householdId])).rows as Row[];
  }

  async createInventory(userId: number, householdId: number, input: InventoryCreateInput) {
    return this.tx(async (client) => {
      if (!await this.member(client, householdId, userId)) return { kind: "not_member" as const };
      const inserted = await client.query(`INSERT INTO household_inventory_items
        (household_id,created_by_user_id,food_name,category,quantity,expiration_date,storage_location,image_url,is_available)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`, [householdId, userId, input.food_name, input.category || "蔬菜",
      input.quantity || "1份", input.expiration_date, input.storage_location || "冷藏", input.image_url || null]);
      await this.activity(client, householdId, userId, "add", input.food_name, input.quantity || "1份", input.storage_location || "冷藏");
      const item = (await client.query(`${inventorySelect} WHERE hi.id=$1`, [inserted.rows[0]!.id])).rows[0] as Row;
      return { kind: "completed" as const, item };
    });
  }

  async updateInventory(userId: number, householdId: number, itemId: number, input: InventoryUpdateInput) {
    return this.tx(async (client) => {
      if (!await this.member(client, householdId, userId, true)) return { kind: "not_member" as const };
      const current = (await client.query("SELECT * FROM household_inventory_items WHERE id=$1 AND household_id=$2 FOR UPDATE",
      [itemId, householdId])).rows[0] as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      if (Number(current.version) !== input.version) return { kind: "version_conflict" as const };
      await client.query(`UPDATE household_inventory_items SET food_name=$1,category=$2,quantity=$3,expiration_date=$4,
        storage_location=$5,image_url=$6,is_available=$7,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$8 AND household_id=$9`, [
        input.food_name ?? current.food_name, input.category ?? current.category, input.quantity ?? current.quantity,
        input.expiration_date ?? current.expiration_date, input.storage_location ?? current.storage_location,
        input.image_url ?? current.image_url, input.is_available ?? current.is_available, itemId, householdId,
      ]);
      await this.activity(client, householdId, userId, "edit", input.food_name || String(current.food_name), input.quantity || String(current.quantity),
        input.storage_location || String(current.storage_location));
      const item = (await client.query("SELECT * FROM household_inventory_items WHERE id=$1", [itemId])).rows[0] as Row;
      return { kind: "completed" as const, item };
    });
  }

  async removeInventory(userId: number, householdId: number, itemId: number, version: number) {
    return this.tx(async (client) => {
      if (!await this.member(client, householdId, userId, true)) return "not_member" as const;
      const item = (await client.query("SELECT * FROM household_inventory_items WHERE id=$1 AND household_id=$2 FOR UPDATE",
      [itemId, householdId])).rows[0] as Row | undefined;
      if (!item) return "not_found" as const;
      if (Number(item.version) !== version) return "version_conflict" as const;
      await client.query("DELETE FROM household_inventory_items WHERE id=$1", [itemId]);
      await this.activity(client, householdId, userId, "consume", String(item.food_name), String(item.quantity), String(item.storage_location));
      return "removed" as const;
    });
  }

  async history(userId: number, householdId: number) {
    if (!await this.member(this.pool, householdId, userId)) return null;
    return (await this.pool.query(`SELECT hl.*,COALESCE(u.nickname,u.username) AS operator_name,u.avatar_url AS operator_avatar
      FROM household_activity_logs hl LEFT JOIN users u ON hl.operator_user_id=u.id WHERE hl.household_id=$1
      ORDER BY hl.created_at DESC LIMIT 100`, [householdId])).rows as Row[];
  }

  private async member(client: Pool | PoolClient, householdId: number, userId: number, lock = false) {
    // Match leave/dissolve lock order before holding the membership through a mutation.
    if (lock) await client.query("SELECT id FROM households WHERE id=$1 FOR KEY SHARE",[householdId]);
    return (await client.query(`SELECT * FROM household_members WHERE household_id=$1 AND user_id=$2${lock ? " FOR SHARE" : ""}`, [householdId, userId]))
      .rows[0] as Row | undefined;
  }
  private activity(client: PoolClient, householdId: number, userId: number, action: string, name: string, quantity: string, location = "") {
    return client.query(`INSERT INTO household_activity_logs
      (household_id,operator_user_id,action,food_name,quantity,storage_location) VALUES ($1,$2,$3,$4,$5,$6)`,
    [householdId, userId, action, name, quantity, location || "-"]);
  }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const value = await operation(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
