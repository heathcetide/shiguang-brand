import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);
type Row = Record<string, any>;

test("HTTP core loop survives crashes, lost responses, duplicate submissions and account changes", { timeout: 90_000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "dietdigidose-core-loop-"));
  const databasePath = path.join(directory, "acceptance.db");
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: "0",
    DATABASE_DRIVER: "sqlite", DATABASE_URL: "", DATABASE_PATH: databasePath,
    JWT_SECRET: randomUUID() + randomUUID(), ADMIN_INITIAL_PASSWORD: "LocalTestPassword1234",
    ENABLE_DEMO_SEED: "0", MEDIA_LOCAL_ROOT: directory,
    REGISTER_RATE_LIMIT: "100", REGISTER_GLOBAL_RATE_LIMIT: "100",
  };
  let child: ChildProcess | undefined;
  let baseUrl = "";
  let db: Database.Database | undefined;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  t.after(async () => {
    await stop();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function start() {
    let output = "";
    child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, fileURLToPath(new URL("../src/index.ts", import.meta.url))], {
      cwd: directory, env, stdio: ["ignore", "pipe", "pipe"],
    });
    const running = child;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { running.kill("SIGKILL"); reject(new Error(`Local server did not start: ${output}`)); }, 30_000);
      running.once("error", error => { clearTimeout(timer); reject(error); });
      running.once("exit", code => { clearTimeout(timer); reject(new Error(`Local server exited (${code}): ${output}`)); });
      running.stdout!.on("data", data => {
        output = (output + String(data)).slice(-8_000);
        const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)\//);
        if (match) { clearTimeout(timer); baseUrl = match[1]; resolve(); }
      });
      running.stderr!.on("data", data => { output = (output + String(data)).slice(-8_000); });
    });
  }
  async function request(route: string, token: string, body?: unknown, expected: number | number[] = body ? 201 : 200) {
    const response = await fetch(`${baseUrl}/api/v1${route}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as Row;
    assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${route} -> ${response.status}: ${JSON.stringify(result)}`);
    return result;
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await start();
  db = new Database(databasePath);
  // Only catalogue setup bypasses HTTP, in this new temporary database.
  // Synthetic content is deliberately not evidence of recipe or food safety.
  db.prepare("UPDATE recipes SET quality_status='needs_review'").run();
  const recipeId = Number(db.prepare(`INSERT INTO recipes(title,status,quality_status,nutrition_basis,ingredients_json,steps_json,serving_size,cook_time,prep_time)
    VALUES('闭环合成蒸蛋','approved','trusted','unknown','[{"name":"闭环鸡蛋","amount":"1个"}]','["仅用于软件验收"]',1,10,0)`).run().lastInsertRowid);
  const password = "CoreLoopTestPassword1234";
  const register = (identifier: string) => request("/auth/register", "", { identifier, username: identifier.split("@")[0], password });
  const owner = await register("core-owner@example.invalid");
  const other = await register("core-other@example.invalid");
  const token = owner.token as string;
  let stock: Row, plan: Row, queue: Row, made: Row;
  const intake = { idempotency_key: randomUUID(), source: "manual", source_reference: "core-loop-intake", items: [{
    food_name: "闭环鸡蛋", category: "蛋类", quantity: "6个", quantity_value: 6, quantity_unit: "piece",
    expiration_date: tomorrow, storage_location: "冷藏", source_item_id: "core-loop:egg", confirmed: true, source: "manual",
  }] };
  await t.test("intake retry after response loss preserves one batch across a process crash", async () => {
    await request("/inventory/bulk-intake", token, intake); // Response intentionally discarded.
    await stop();
    await assert.rejects(fetch(`${baseUrl}/api/v1/inventory`, { signal: AbortSignal.timeout(1_000) }));
    await start();
    const replay = await request("/inventory/bulk-intake", token, intake, 200);
    stock = replay.items[0];
    const inventory = await request("/inventory", token);
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].quantity_value, 6);
    assert.equal(inventory[0].id, stock.id);
    assert.deepEqual(await request("/inventory", other.token), []);
  });
  await t.test("recommendation generates two meals and activation replay preserves one plan", async () => {
    const home = await request("/ai/home-recommendations", token, { period: "晚餐", requestKey: "core-nutrition" }, 200);
    assert.equal(home.cards[0].calories, null);
    assert.equal(home.recommendations.items[0].recipe.protein, null);
    const draft = await request("/recommendations/cooking-plan", token, { productionDate: today, meals: [
      { id: "today", date: today, mealType: "dinner", servings: 1 },
      { id: "tomorrow", date: tomorrow, mealType: "lunch", servings: 2 },
    ] }, 200);
    assert.equal(draft.totalCookServings, 3);
    assert.equal(draft.cooking.length, 2);
    assert(draft.cooking.every((item: Row) => item.recipeId === recipeId));
    assert.equal(draft.status, "requires_validation");
    assert.equal(draft.time.incomplete, true);
    const id = randomUUID();
    await request("/meal-plans/drafts", token, { id, title: "两餐一次共做", draft });
    await request(`/meal-plans/${id}/activate`, token, { version: 1 }, 200);
    await stop();
    await start();
    const replay = await request(`/meal-plans/${id}/activate`, token, { version: 1 }, 200);
    assert.equal(replay.repeated, true);
    plan = replay.plan;
    assert.equal(plan.items.length, 2);
    assert.equal((await request("/meal-plans", token)).length, 1);
    await request(`/meal-plans/${id}`, other.token, undefined, 404);
  });
  await t.test("two meals share one queue and duplicate starts cannot deduct stock", async () => {
    const item = plan.items[0];
    const route = `/meal-plans/${plan.id}/items/${item.id}/queue`;
    const input = { version: item.version, idempotencyKey: randomUUID(), combineSameRecipe: true };
    await request(route, token, input);
    assert.equal((await request(route, token, input, 200)).repeated, true);
    const rows = await request("/cooking-queue", token);
    assert.equal(rows.length, 1);
    queue = rows[0];
    assert.equal(queue.plannedServings, 3);
    const version = queue.version;
    queue = await request(`/cooking-queue/${queue.id}/start`, token, { version }, 200);
    assert.equal((await request(`/cooking-queue/${queue.id}/start`, token, { version }, 200)).version, queue.version);
    assert.equal((await request("/inventory", token))[0].quantity_value, 6);
    assert.deepEqual(await request("/cooking-queue", other.token), []);
  });
  const production = () => ({ idempotency_key: "core-production-replay", inventory_consumptions: [
    { item_id: stock.id, version: stock.version, mode: "amount", amount_value: 3, unit: "piece" },
  ], production: { food_name: "闭环合成蒸蛋", produced_servings: 3, eaten_servings: 1,
    eaten_at: today, meal_type: "晚餐", queue_item_id: queue.id, queue_version: queue.version } });
  await t.test("lost production response and restart cannot repeat deductions or intake", async () => {
    const concurrent = await Promise.all([1, 2].map(() => request("/diet-records/cooking-completions", token, production(), [200, 201])));
    assert.deepEqual(concurrent.map(result => result.repeated).sort(), [false, true]);
    assert.equal(concurrent[0].prepared_meal.id, concurrent[1].prepared_meal.id);
    await stop();
    await start();
    made = await request("/diet-records/cooking-completions", token, production(), 200);
    assert.equal(made.repeated, true);
    assert.equal(made.prepared_meal.remaining_servings, 2);
    assert.deepEqual(made.prepared_meal.allocations.map((allocation: Row) => [allocation.plannedDate, allocation.remainingServings]), [[tomorrow, 2]]);
    assert.equal(made.diet_record.amount, "1份");
    assert.equal(made.diet_record.calories, null);
    assert.equal((await request("/inventory", token))[0].quantity_value, 3);
    assert.equal((await request("/diet-records", token)).length, 1);
    const saved = await request(`/meal-plans/${plan.id}`, token);
    assert(saved.items.every((item: Row) => item.status === "completed"));
    assert.equal((await request("/cooking-queue?includeHistory=true", token))[0].status, "completed");
  });
  await t.test("later eating, stale writes, account changes and old retries preserve current portions", async () => {
    const route = `/diet-records/prepared-meals/${made.prepared_meal.id}/events`;
    const input = { idempotency_key: randomUUID(), version: made.prepared_meal.version,
      type: "eat", servings: 0.5, recorded_at: tomorrow, meal_type: "午餐" };
    await request(route, other.token, input, 409);
    const eaten = await request(route, token, input);
    assert.equal(eaten.prepared_meal.remaining_servings, 1.5);
    await request(route, token, { ...input, idempotency_key: randomUUID() }, 409);
    await stop();
    await start();
    const loggedIn = await request("/auth/login", "", { identifier: "core-owner@example.invalid", password }, 200);
    assert.equal((await request(route, loggedIn.token, input, 200)).diet_record.id, eaten.diet_record.id);
    await request("/diet-records/cooking-completions", loggedIn.token, production(), 200);
    const meals = await request("/diet-records/prepared-meals", loggedIn.token);
    assert.equal(meals.length, 1);
    assert.equal(meals[0].remaining_servings, 1.5);
    assert.equal(meals[0].allocations[0].remainingServings, 1.5);
    const records = await request("/diet-records", loggedIn.token);
    assert.equal(records.length, 2);
    assert.equal(records.find((row: Row) => row.id === eaten.diet_record.id).amount, "0.5份");
    assert.equal((await request("/inventory", loggedIn.token))[0].quantity_value, 3);
    assert.deepEqual(await request("/diet-records/prepared-meals", other.token), []);
    assert.deepEqual(await request("/diet-records", other.token), []);
    assert.deepEqual(await request("/meal-plans", other.token), []);
  });
});
