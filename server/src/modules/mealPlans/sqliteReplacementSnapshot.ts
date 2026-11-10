import type { ActiveMealChangePreviewInput } from "@dietdigidose/contracts";
import { replacementInputTables, replacementRuleTables, replacementRecipeIds, finalizeReplacementSnapshot } from "./replacementSnapshot.js";
import type { Row } from "./formatters.js";
export function readSqliteReplacementSnapshot(readRows: (sql: string, parameters: unknown[]) => Row[], userId: number, request: ActiveMealChangePreviewInput) {
  const data: Record<string, Row[]> = {};
  for (const table of replacementInputTables) data[table] = readRows(`SELECT * FROM ${table} WHERE user_id=? ORDER BY id`,[userId]);
  for (const table of replacementRuleTables) data[table] = readRows(`SELECT * FROM ${table}`,[]);
  data.meal_plan_changes = "changeId" in request ? readRows("SELECT * FROM meal_plan_changes WHERE id=? AND user_id=?",[request.changeId,userId]) : [];
  const ids = replacementRecipeIds(data, request);
  data.recipes = ids.length ? readRows(`SELECT * FROM recipes WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,ids) : [];
  return finalizeReplacementSnapshot(userId, data, request);
}
