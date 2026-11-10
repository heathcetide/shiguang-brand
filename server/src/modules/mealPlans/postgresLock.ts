import type { PoolClient } from "pg";

/** Acquire before row locks in every writer that can change a user's meal plan. */
export async function lockMealPlanning(client: PoolClient, userId: number) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`meal-plan-activation:${userId}`]);
}
