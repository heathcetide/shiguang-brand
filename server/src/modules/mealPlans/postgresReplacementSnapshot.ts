import type { PoolClient } from "pg";
import type { ActiveMealChangePreviewInput } from "@dietdigidose/contracts";
import { replacementInputTables, replacementRuleTables, replacementRecipeIds, finalizeReplacementSnapshot } from "./replacementSnapshot.js";
import type { Row } from "./formatters.js";
/** Caller holds meal-planning lock before entering write mode, and no input row locks yet. */
export async function readPostgresReplacementSnapshot(client: PoolClient, userId: number, request: ActiveMealChangePreviewInput, lock = false) {
  const data: Record<string, Row[]> = {};
  // NOWAIT prevents waiting on a writer that holds an input row and needs the parent FK.
  // 55P03 is handled only after the caller's transaction has rolled back.
  if (lock) await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT", [userId]);
  const suffix = lock ? " FOR UPDATE NOWAIT" : "";
  for (const table of replacementInputTables) data[table] = (await client.query(`SELECT * FROM ${table} WHERE user_id=$1 ORDER BY id${suffix}`, [userId])).rows;
  if (lock) await client.query(`LOCK TABLE ${replacementRuleTables.join(",")} IN SHARE MODE NOWAIT`);
  for (const table of replacementRuleTables) data[table] = (await client.query(`SELECT * FROM ${table}`)).rows;
  data.meal_plan_changes = "changeId" in request ? (await client.query(`SELECT * FROM meal_plan_changes WHERE id=$1 AND user_id=$2${suffix}`, [request.changeId,userId])).rows : [];
  const ids = replacementRecipeIds(data, request);
  data.recipes = ids.length ? (await client.query(`SELECT * FROM recipes WHERE id=ANY($1::integer[]) ORDER BY id${lock ? " FOR SHARE NOWAIT" : ""}`, [ids])).rows : [];
  return finalizeReplacementSnapshot(userId,data,request);
}
