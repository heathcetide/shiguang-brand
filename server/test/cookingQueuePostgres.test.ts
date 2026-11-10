import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { PostgresCookingQueueRepository } from "../src/modules/cookingQueue/postgresRepository.js";

// Opt-in dedicated test database; never fall back to the application's DATABASE_URL.
test("PostgreSQL queue cancellation restores meals atomically", { skip: !process.env.QUEUE_TEST_DATABASE_URL }, async () => {
  const schema = `queue_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.QUEUE_TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.QUEUE_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    await pool.query(`
      CREATE TABLE cooking_queue_items(id text PRIMARY KEY, user_id integer, recipe_id integer, status text,
        version integer, deleted_at timestamptz, updated_at timestamptz, meal_type text, planned_at timestamptz,
        prepared_ingredients_json jsonb, shopping_list_synced_at timestamptz, completed_at timestamptz);
      CREATE TABLE meal_plan_items(id text PRIMARY KEY, user_id integer, queue_item_id text, status text,
        version integer, deleted_at timestamptz, updated_at timestamptz);
      CREATE TABLE recipes(id integer, title text, image_url text, cook_time integer, calories integer,
        difficulty text, ingredients_json jsonb, deleted_at timestamptz, status text);
    `);
    const [a, b, done, other] = Array.from({ length: 4 }, () => randomUUID());
    for (const [id, user, status] of [[a, 1, "waiting"], [b, 1, "cooking"], [done, 1, "completed"], [other, 2, "waiting"]]) {
      await pool.query("INSERT INTO cooking_queue_items(id,user_id,status,version) VALUES($1,$2,$3,1)", [id, user, status]);
      await pool.query("INSERT INTO meal_plan_items(id,user_id,queue_item_id,status,version) VALUES($1,$2,$1,$3,2)", [id, user, status === "completed" ? "completed" : "queued"]);
    }
    const repository = new PostgresCookingQueueRepository(pool);
    const meal = async (id: string) => (await pool.query("SELECT status,queue_item_id,version FROM meal_plan_items WHERE id=$1", [id])).rows[0];
    assert.equal(await repository.cancel(a, 2), false);
    assert.equal(await repository.cancel(a, 1), true);
    assert.deepEqual(await meal(a), { status: "planned", queue_item_id: null, version: 3 });
    const patch = { status: "cancelled" as const, mealType: null, plannedAt: null, preparedIngredients: [], shoppingListSyncedAt: null, completedAt: null };
    assert.equal(await repository.update(b, 1, 99, patch), null);
    assert.equal((await meal(b)).status, "queued");
    assert.equal((await repository.update(b, 1, 1, patch))?.status, "cancelled");
    assert.deepEqual(await meal(b), { status: "planned", queue_item_id: null, version: 3 });

    await pool.query("UPDATE cooking_queue_items SET status='waiting' WHERE id=ANY($1::text[])", [[a, b]]);
    await pool.query("UPDATE meal_plan_items SET status='queued',queue_item_id=id WHERE id=ANY($1::text[])", [[a, b]]);
    await pool.query(`CREATE FUNCTION fail_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'write failed'; END $$;
      CREATE TRIGGER fail_meal_update BEFORE UPDATE ON meal_plan_items FOR EACH ROW EXECUTE FUNCTION fail_update()`);
    await assert.rejects(repository.cancelAll(1), /write failed/);
    assert.equal((await pool.query("SELECT status FROM cooking_queue_items WHERE id=$1", [a])).rows[0].status, "waiting");
    await pool.query("DROP TRIGGER fail_meal_update ON meal_plan_items");
    assert.equal(await repository.cancelAll(1), 2);
    assert.equal((await meal(a)).queue_item_id, null);
    assert.equal((await meal(b)).queue_item_id, null);
    assert.equal((await meal(done)).status, "completed");
    assert.equal((await meal(other)).status, "queued");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
