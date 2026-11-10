import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { createDatabaseBackup, inspectDatabase, restoreDatabaseBackup } from "./database-backup.js";

type Check = { name: string; durationMs: number; details?: Record<string, unknown> };
type ServerHandle = { baseUrl: string; process: ChildProcess; logs: string[]; stop: () => Promise<void> };

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function argumentValue(name: string) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

function gitSha() {
  const configured = process.env.CANDIDATE_GIT_SHA?.trim();
  if (configured) return configured;
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(serverRoot, ".."), encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function inspectBundledCatalog(databasePath: string) {
  const startedAt = performance.now();
  const database = new Database(databasePath, { readonly: true });
  try {
    const ingredients = database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN normalized_name IS NOT NULL AND source_version IS NOT NULL
          AND source_updated_at IS NOT NULL AND data_license = 'US-Public-Domain'
          AND nutrition_basis = 'per_100g' AND quality_status = 'trusted' THEN 1 ELSE 0 END) AS governed,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM ingredient_aliases a WHERE a.ingredient_id = ingredients_library.id)
          AND EXISTS (SELECT 1 FROM ingredient_portions p WHERE p.ingredient_id = ingredients_library.id)
          THEN 1 ELSE 0 END) AS indexed
      FROM ingredients_library
      WHERE source = 'usda_fdc_foundation' AND deleted_at IS NULL
    `).get() as { total: number; governed: number; indexed: number };
    const recipes = database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN canonical_key IS NOT NULL AND source_content_hash IS NOT NULL
          AND data_license = 'DietDigiDose-Original' AND source_revision = 'usda-based-catalog-v1'
          AND source_attribution IS NOT NULL AND quality_status = 'trusted'
          AND nutrition_basis = 'ingredient_estimate' THEN 1 ELSE 0 END) AS governed
      FROM recipes
      WHERE source = 'usda_based' AND deleted_at IS NULL
    `).get() as { total: number; governed: number };
    if (!ingredients.total || ingredients.governed !== ingredients.total || ingredients.indexed !== ingredients.total) {
      throw new Error(`bundled ingredient governance failed: ${JSON.stringify(ingredients)}`);
    }
    if (!recipes.total || recipes.governed !== recipes.total) {
      throw new Error(`bundled recipe governance failed: ${JSON.stringify(recipes)}`);
    }
    return { ingredients, recipes, durationMs: Math.round(performance.now() - startedAt) };
  } finally {
    database.close();
  }
}

async function startServer(databasePath: string, mediaRoot: string, adminPassword: string): Promise<ServerHandle> {
  const entryPoint = path.join(serverRoot, "dist", "index.js");
  if (!fs.existsSync(entryPoint)) throw new Error("dist/index.js is missing; run pnpm --dir server build first");
  const child = spawn(process.execPath, [entryPoint], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "0",
      DATABASE_PATH: databasePath,
      DATABASE_DRIVER: "sqlite",
      DATABASE_URL: "",
      MEDIA_LOCAL_ROOT: mediaRoot,
      JWT_SECRET: "database-rehearsal-jwt-secret-at-least-32-characters",
      ADMIN_INITIAL_PASSWORD: adminPassword,
      ENABLE_DEMO_SEED: "0",
      REQUIRE_HTTPS: "0",
      TRUST_PROXY: "0",
      CORS_ORIGINS: "https://rehearsal.invalid",
      REGISTER_RATE_LIMIT: "1000",
      REGISTER_GLOBAL_RATE_LIMIT: "5000",
      ERROR_MONITOR_WEBHOOK_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  const baseUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server startup timed out: ${logs.slice(-10).join(" | ")}`)), 20_000);
    let bufferedOutput = "";
    const consume = (chunk: Buffer) => {
      const text = chunk.toString();
      logs.push(...text.split(/\r?\n/).filter(Boolean));
      bufferedOutput = `${bufferedOutput}${text}`.slice(-4_000);
      const match = bufferedOutput.match(/Server listening at http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`server exited during startup with code ${code}: ${logs.slice(-10).join(" | ")}`)); });
  });
  return {
    baseUrl,
    process: child,
    logs,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
        child.once("exit", () => { clearTimeout(timeout); resolve(); });
      });
    },
  };
}

async function request(baseUrl: string, pathname: string, options: RequestInit & { token?: string } = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} -> ${response.status}: ${JSON.stringify(body)}`);
  return { body, durationMs: Math.round(performance.now() - startedAt), status: response.status };
}

async function runCoreJourney(baseUrl: string, label: string, adminInitialPassword: string, checks: Check[]) {
  const suffix = `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const identifier = `${suffix}@example.invalid`;
  const password = `Drill${randomUUID().replaceAll("-", "").slice(0, 14)}9`;
  const secondIdentifier = `isolation-${suffix}@example.invalid`;
  const secondPassword = `Isolate${randomUUID().replaceAll("-", "").slice(0, 12)}8`;
  const expirationDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const addCheck = (name: string, result: { durationMs: number }, details?: Record<string, unknown>) => {
    checks.push({ name: `${label}.${name}`, durationMs: result.durationMs, details });
  };

  const health = await request(baseUrl, "/api/v1/health");
  addCheck("health", health);
  const registered = await request(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ identifier, username: `演练用户${label}`, password }),
  });
  addCheck("register", registered);
  const token = registered.body.token as string;
  const inventoryIds: number[] = [];
  for (const [foodName, category, quantity] of [
    [`演练番茄-${label}`, "蔬菜", "2个"],
    [`演练鸡蛋-${label}`, "蛋奶", "4个"],
    [`演练米饭-${label}`, "主食", "300克"],
  ]) {
    const created = await request(baseUrl, "/api/v1/inventory", {
      method: "POST",
      token,
      body: JSON.stringify({ food_name: foodName, category, quantity, expiration_date: expirationDate, storage_location: "冷藏" }),
    });
    inventoryIds.push(created.body.id);
    addCheck("inventory.create", created, { foodName });
  }
  const inventory = await request(baseUrl, "/api/v1/inventory", { token });
  if (!inventoryIds.every((id) => inventory.body.some((item: any) => item.id === id))) throw new Error(`${label}: inventory round trip failed`);
  addCheck("inventory.list", inventory, { count: inventory.body.length });
  const recipes = await request(baseUrl, "/api/v1/recipes");
  if (!Array.isArray(recipes.body) || !recipes.body.length) throw new Error(`${label}: no approved recipes`);
  const recipe = recipes.body[0];
  addCheck("recipes.list", recipes, { count: recipes.body.length });
  const cooking = await request(baseUrl, "/api/v1/diet-records/cooking-completions", {
    method: "POST",
    token,
    body: JSON.stringify({
      idempotency_key: `database-drill-${suffix}`,
      recipe_id: recipe.id,
      inventory_item_ids: [inventoryIds[0]],
      diet_record: {
        meal_type: "午餐",
        food_name: recipe.title,
        amount: "1份",
        calories: recipe.calories,
        recorded_at: new Date().toISOString().slice(0, 10),
      },
    }),
  });
  addCheck("cooking.complete", cooking);
  const dietRecords = await request(baseUrl, "/api/v1/diet-records", { token });
  if (!dietRecords.body.some((record: any) => record.food_name === recipe.title)) throw new Error(`${label}: diet record missing`);
  addCheck("diet-records.list", dietRecords, { count: dietRecords.body.length });

  const upload = await request(baseUrl, "/api/v1/media/images", {
    method: "POST",
    token,
    body: JSON.stringify({ data_url: onePixelPng, scope: "community" }),
  });
  const uploadedPath = new URL(upload.body.url, baseUrl).pathname;
  addCheck("media.upload", upload, { bytes: upload.body.bytes });
  const post = await request(baseUrl, "/api/v1/community/posts", {
    method: "POST",
    token,
    body: JSON.stringify({ content: `数据库演练媒体引用 ${label}`, image_urls: [uploadedPath], category: "寻味" }),
  });
  addCheck("community.post", post, { postId: post.body.id });
  const bookmark = await request(baseUrl, `/api/v1/community/posts/${post.body.id}/bookmark`, { method: "PUT", token });
  if (bookmark.body.bookmarked !== true) throw new Error(`${label}: bookmark creation failed`);
  addCheck("community.bookmark", bookmark);

  const second = await request(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ identifier: secondIdentifier, username: `隔离用户${label}`, password: secondPassword }),
  });
  const isolatedInventory = await request(baseUrl, "/api/v1/inventory", { token: second.body.token });
  if (isolatedInventory.body.some((item: any) => inventoryIds.includes(item.id))) throw new Error(`${label}: user isolation failed`);
  addCheck("user-isolation", isolatedInventory, { foreignItemsVisible: 0 });

  const adminLogin = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: "admin", password: adminInitialPassword }),
  });
  const rotatedAdminPassword = `Rotated${randomUUID().replaceAll("-", "").slice(0, 14)}7`;
  const changed = await request(baseUrl, "/api/v1/auth/change-password", {
    method: "POST",
    token: adminLogin.body.token,
    body: JSON.stringify({ currentPassword: adminInitialPassword, newPassword: rotatedAdminPassword }),
  });
  addCheck("admin.password-rotated", changed);
  const rotatedLogin = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: "admin", password: rotatedAdminPassword }),
  });
  const stats = await request(baseUrl, "/api/v1/admin/stats", { token: rotatedLogin.body.token });
  addCheck("admin.stats", stats, { users: stats.body.users, inventory: stats.body.inventory });
  return {
    identifier,
    password,
    secondIdentifier,
    secondPassword,
    userId: registered.body.user.id as number,
    inventoryIds,
    recipeTitle: recipe.title as string,
    postId: post.body.id as number,
    mediaPath: uploadedPath,
    rotatedAdminPassword,
    adminSummary: { users: Number(stats.body.users), inventory: Number(stats.body.inventory) },
  };
}

async function verifyRecoveredJourney(baseUrl: string, label: string, journey: Awaited<ReturnType<typeof runCoreJourney>>, checks: Check[], expectCutoffMarker: boolean) {
  const health = await request(baseUrl, "/api/v1/health");
  checks.push({ name: `${label}.health`, durationMs: health.durationMs });
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: journey.identifier, password: journey.password }),
  });
  checks.push({ name: `${label}.login`, durationMs: login.durationMs });
  const inventory = await request(baseUrl, "/api/v1/inventory", { token: login.body.token });
  const hasOriginal = journey.inventoryIds.slice(1).every((id) => inventory.body.some((item: any) => item.id === id));
  const hasCutoffMarker = inventory.body.some((item: any) => item.food_name === "备份后写入标记");
  if (!hasOriginal || hasCutoffMarker !== expectCutoffMarker) throw new Error(`${label}: restored inventory boundary is incorrect`);
  checks.push({ name: `${label}.inventory`, durationMs: inventory.durationMs, details: { hasCutoffMarker } });
  const secondLogin = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: journey.secondIdentifier, password: journey.secondPassword }),
  });
  const isolatedInventory = await request(baseUrl, "/api/v1/inventory", { token: secondLogin.body.token });
  if (isolatedInventory.body.some((item: any) => journey.inventoryIds.includes(item.id))) throw new Error(`${label}: restored user isolation failed`);
  checks.push({ name: `${label}.user-isolation`, durationMs: secondLogin.durationMs + isolatedInventory.durationMs, details: { foreignItemsVisible: 0 } });
  const diet = await request(baseUrl, "/api/v1/diet-records", { token: login.body.token });
  if (!diet.body.some((record: any) => record.food_name === journey.recipeTitle)) throw new Error(`${label}: restored diet record missing`);
  checks.push({ name: `${label}.diet-records`, durationMs: diet.durationMs });
  const post = await request(baseUrl, `/api/v1/community/posts/${journey.postId}`);
  if (!post.body.image_urls?.includes(journey.mediaPath)) throw new Error(`${label}: restored media reference missing`);
  const bookmarked = await request(baseUrl, `/api/v1/community/posts/${journey.postId}`, { token: login.body.token });
  const isolatedBookmark = await request(baseUrl, `/api/v1/community/posts/${journey.postId}`, { token: secondLogin.body.token });
  if (bookmarked.body.is_bookmarked !== true || isolatedBookmark.body.is_bookmarked !== false) throw new Error(`${label}: restored bookmark or account isolation is incorrect`);
  checks.push({ name: `${label}.community.bookmark`, durationMs: bookmarked.durationMs + isolatedBookmark.durationMs, details: { persisted: true, isolated: true } });
  checks.push({ name: `${label}.media-reference`, durationMs: post.durationMs });
  const adminLogin = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: "admin", password: journey.rotatedAdminPassword }),
  });
  const stats = await request(baseUrl, "/api/v1/admin/stats", { token: adminLogin.body.token });
  const expectedInventory = journey.adminSummary.inventory + (expectCutoffMarker ? 1 : 0);
  if (Number(stats.body.users) !== journey.adminSummary.users || Number(stats.body.inventory) !== expectedInventory) {
    throw new Error(`${label}: restored admin summary is inconsistent`);
  }
  checks.push({ name: `${label}.admin.stats`, durationMs: stats.durationMs, details: { users: stats.body.users, inventory: stats.body.inventory } });
}

// Test/rehearsal helper only, never a production downgrade path.
export function rollbackPreviousCandidateFixture(legacyDatabase: Database.Database, previousVersion: number) {
  const newerVersions = legacyDatabase.prepare("SELECT version FROM schema_migrations WHERE version > ? ORDER BY version DESC")
    .all(previousVersion) as Array<{ version: number }>;
  const unsupportedVersions = newerVersions.filter((migration) => !Array.from({ length: 32 }, (_, index) => 59 + index).includes(migration.version));
  if (unsupportedVersions.length) {
    throw new Error(`database rehearsal needs rollback fixtures for migrations: ${unsupportedVersions.map((item) => item.version).join(", ")}`);
  }
  legacyDatabase.transaction(() => {
  for (const migration of newerVersions) {
    if (migration.version === 90) {
      const challenges = legacyDatabase.prepare("SELECT COUNT(*) n FROM email_auth_challenges").get() as { n: number };
      const verified = legacyDatabase.prepare("SELECT COUNT(*) n FROM users WHERE email_verified_at IS NOT NULL").get() as { n: number };
      if (challenges.n || verified.n) throw new Error("Cannot downgrade fixture containing email verification evidence");
      legacyDatabase.exec("DROP TABLE email_auth_challenges; ALTER TABLE users DROP COLUMN email_verified_at");
    }
    if (migration.version === 89) {
      // Only discard the empty bookmark table in our synthetic drill fixture.
      const bookmarks = legacyDatabase.prepare("SELECT COUNT(*) n FROM community_post_bookmarks").get() as { n: number };
      if (bookmarks.n) throw new Error("Cannot downgrade fixture containing community bookmarks");
      legacyDatabase.exec("DROP TABLE community_post_bookmarks");
    }
    if (migration.version === 88) {
      // This reversal is limited to the fresh, unreviewed drill fixture.
      const reviewed = legacyDatabase.prepare("SELECT COUNT(*) n FROM recipes WHERE execution_json IS NOT NULL").get() as { n: number };
      if (reviewed.n) throw new Error("Cannot downgrade fixture containing reviewed execution evidence");
      legacyDatabase.exec("ALTER TABLE recipes DROP COLUMN execution_json");
    }
    if (migration.version === 87) legacyDatabase.exec("DROP TABLE diet_record_create_requests");
    if (migration.version === 86) legacyDatabase.exec("DROP TABLE onboarding_event_receipts; DROP TABLE user_onboarding;");
    if (migration.version === 85) {
      // Only reconstruct the empty drill fixture. Never downgrade real accounts:
      // passwordless users must retain login and account management support.
      const passwordless = legacyDatabase.prepare("SELECT COUNT(*) n FROM users WHERE password_hash IS NULL").get() as { n: number };
      if (passwordless.n) throw new Error("Cannot downgrade fixture containing passwordless accounts");
      legacyDatabase.exec(`DROP TABLE account_reauth_grants;
        ALTER TABLE auth_verification_challenges DROP COLUMN reauth_user_id;
        ALTER TABLE auth_verification_challenges DROP COLUMN reauth_session_version;`);
      const { sql } = legacyDatabase.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string };
      const restored = sql.replace(/\bpassword_hash\s+TEXT\b/i, "password_hash TEXT NOT NULL")
        .replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)["`\[]?users["`\]]?/i, "$1users_rollback85");
      const artifacts = legacyDatabase.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
      const sequence = legacyDatabase.prepare("SELECT seq FROM sqlite_sequence WHERE name='users'").get() as { seq: number } | undefined;
      legacyDatabase.transaction(() => {
        legacyDatabase.exec(restored);
        legacyDatabase.exec(`INSERT INTO users_rollback85 SELECT * FROM users;
          DROP TABLE users; ALTER TABLE users_rollback85 RENAME TO users;`);
        for (const artifact of artifacts) legacyDatabase.exec(artifact.sql);
        if (sequence) legacyDatabase.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='users'").run(sequence.seq);
      })();
    }
    if (migration.version === 84) legacyDatabase.exec(`
      ALTER TABLE user_health_profiles DROP COLUMN profile_version;
      ALTER TABLE user_health_profiles DROP COLUMN nutrition_target_source;
      ALTER TABLE user_health_profiles DROP COLUMN nutrition_target_legacy_json;
      ALTER TABLE user_health_profiles DROP COLUMN nutrition_target_version;
      ALTER TABLE user_health_profiles DROP COLUMN safety_status;
    `);
    if (migration.version === 83) legacyDatabase.exec(`
      DROP TABLE feedback_messages;
      DROP INDEX idx_feedback_request;
      DROP INDEX idx_feedback_status;
      ALTER TABLE user_notification_inbox DROP COLUMN feedback_id;
      ALTER TABLE user_feedback DROP COLUMN request_key;
      ALTER TABLE user_feedback DROP COLUMN version;
      ALTER TABLE user_feedback DROP COLUMN updated_at;
      UPDATE user_feedback SET status = 'open' WHERE status = 'received';
    `);
    if (migration.version === 82) legacyDatabase.exec("DROP TABLE prepared_meal_allocations");
    if (migration.version === 81) {
      // Only this freshly bootstrapped drill fixture is downgraded. A real rc.7
      // database can contain NULL nutrition and must never use this reversal.
      const unknown = legacyDatabase.prepare("SELECT COUNT(*) n FROM ingredients_library WHERE calories_100g IS NULL").get() as { n: number };
      if (unknown.n) throw new Error("Cannot downgrade fixture with unknown ingredient nutrition");
      const { sql } = legacyDatabase.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ingredients_library'").get() as { sql: string };
      const restored = sql.replace(/\bcalories_100g\s+REAL\b/i, "calories_100g REAL NOT NULL")
        .replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)["`\[]?ingredients_library["`\]]?/i, "$1ingredients_library_rollback81");
      if (restored === sql) throw new Error("Unexpected fixture ingredient schema");
      const artifacts = legacyDatabase.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='ingredients_library' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
      const sequence = legacyDatabase.prepare("SELECT seq FROM sqlite_sequence WHERE name='ingredients_library'").get() as { seq: number } | undefined;
      legacyDatabase.transaction(() => {
        legacyDatabase.exec(`DROP TRIGGER base_data_recipe_cooking_guard_insert;
          DROP TRIGGER base_data_recipe_cooking_guard_update;
          DROP TRIGGER base_data_prepared_guard_insert;
          DROP TRIGGER base_data_prepared_guard_update;
          DROP TABLE base_data_runtime_ids;`);
        legacyDatabase.exec(restored);
        legacyDatabase.exec(`INSERT INTO ingredients_library_rollback81 SELECT * FROM ingredients_library;
          DROP TABLE ingredients_library;
          ALTER TABLE ingredients_library_rollback81 RENAME TO ingredients_library;`);
        for (const artifact of artifacts) legacyDatabase.exec(artifact.sql);
        if (sequence) legacyDatabase.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='ingredients_library'").run(sequence.seq);
        legacyDatabase.exec(`ALTER TABLE ingredients_library DROP COLUMN nutrition_status;
          ALTER TABLE recipes DROP COLUMN automatic_inventory_write_allowed;`);
        for (const table of ["recipes", "ingredients_library", "kitchenware_catalog"]) legacyDatabase.exec(`ALTER TABLE ${table} DROP COLUMN base_data_payload`);
        for (const table of ["users", "community_posts", "community_comments", "inventory_items", "recipe_favorites"]) legacyDatabase.exec(`ALTER TABLE ${table} DROP COLUMN is_demo`);
      })();
    }
    if (migration.version === 80) legacyDatabase.exec("DROP TABLE proactive_intervention_scan_cursor;");
    if (migration.version === 79) legacyDatabase.exec("DROP TABLE proactive_intervention_outcomes; DROP TABLE proactive_intervention_actions; DROP TABLE proactive_interventions; DROP TABLE proactive_intervention_preferences;");
    if (migration.version === 78) legacyDatabase.exec("DROP TABLE core_loop_actor_classifications; DROP TABLE core_loop_metric_settings;");
    // These destructive reversals apply only to this newly created, empty drill
    // fixture. They are deliberately not exposed as a production downgrade.
    if (migration.version === 77) legacyDatabase.exec(`
      DROP INDEX idx_household_shopping_plan_demand;
      ALTER TABLE household_shopping_items DROP COLUMN source_plan_item_id;
      ALTER TABLE household_shopping_items DROP COLUMN source_demand_key;
      ALTER TABLE household_shopping_items DROP COLUMN source_generated_version;
    `);
    if (migration.version === 76) legacyDatabase.exec("ALTER TABLE meal_plan_items DROP COLUMN dining_json; ALTER TABLE household_meal_batches DROP COLUMN dining_json;");
    if (migration.version === 75) legacyDatabase.exec("DROP INDEX idx_household_meal_batches_plan; ALTER TABLE household_meal_batches DROP COLUMN plan_item_id;");
    if (migration.version === 74) legacyDatabase.exec("DROP TABLE household_meal_reservations; ALTER TABLE household_meal_events DROP COLUMN reserved_servings_used;");
    if (migration.version === 73) legacyDatabase.exec("DROP TABLE household_meal_intake_corrections;");
    if (migration.version === 72) legacyDatabase.exec("DROP TABLE household_meal_events;");
    if (migration.version === 71) legacyDatabase.exec("DROP TABLE household_meal_batches;");
    if (migration.version === 70) legacyDatabase.exec(`
      ALTER TABLE household_members DROP COLUMN dining_shared;
      ALTER TABLE household_members DROP COLUMN dining_preferences_json;
      ALTER TABLE household_members DROP COLUMN dining_version;
    `);
    if (migration.version === 69) legacyDatabase.exec("DROP TABLE plan_maintenance_job_events; DROP TABLE plan_maintenance_jobs;");
    if (migration.version === 68) legacyDatabase.exec("DROP TABLE plan_maintenance_events;");
    if (migration.version === 67) legacyDatabase.exec("DROP TABLE plan_maintenance_settings;");
    if (migration.version === 66) legacyDatabase.exec("ALTER TABLE prepared_meals DROP COLUMN reported_cooking_minutes;");
    if (migration.version === 65) legacyDatabase.exec("DROP TABLE recommendation_learning_settings;");
    if (migration.version === 64) legacyDatabase.exec("DROP TABLE meal_plan_changes; ALTER TABLE meal_plan_items DROP COLUMN confirmed_at;");
    if (migration.version === 63) legacyDatabase.exec("DROP TABLE prepared_meal_intake_corrections;");
    if (migration.version === 62) legacyDatabase.exec(`
      DROP INDEX idx_cooking_queue_active_plan_item;
      DROP INDEX idx_cooking_queue_active_recipe;
      ALTER TABLE cooking_queue_items DROP COLUMN source_plan_item_id;
      CREATE UNIQUE INDEX idx_cooking_queue_active_recipe ON cooking_queue_items(user_id,recipe_id)
        WHERE deleted_at IS NULL AND status IN ('waiting','preparing','ready','cooking');
    `);
    if (migration.version === 61) legacyDatabase.exec("ALTER TABLE prepared_meals DROP COLUMN is_reserved");
    if (migration.version === 60) legacyDatabase.exec("DROP TABLE prepared_meal_events; DROP TABLE prepared_meals;");
    if (migration.version === 59) legacyDatabase.exec("DROP TABLE IF EXISTS worker_task_runs; DROP TABLE IF EXISTS worker_task_leases;");
    legacyDatabase.prepare("DELETE FROM schema_migrations WHERE version = ?").run(migration.version);
  }
  })();
}

async function main() {
  const owner = argumentValue("--owner") || process.env.DRILL_OWNER?.trim() || os.userInfo().username;
  const output = argumentValue("--output");
  const keep = process.argv.includes("--keep");
  const previousVersion = Number(argumentValue("--previous-version") || 58);
  if (!Number.isInteger(previousVersion) || previousVersion < 1) throw new Error("--previous-version must be a positive integer");
  const drillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-database-drill-"));
  const checks: Check[] = [];
  const startedAt = new Date();
  let success = false;
  let activeServer: ServerHandle | null = null;
  try {
    const freshPath = path.join(drillRoot, "fresh.db");
    const legacyPath = path.join(drillRoot, "previous-candidate.db");
    const independentRecoveryPath = path.join(drillRoot, "independent-recovery.db");
    const backupPath = path.join(drillRoot, "backups", "candidate.db");
    const adminInitialPassword = `Initial${randomUUID().replaceAll("-", "").slice(0, 14)}6`;

    activeServer = await startServer(freshPath, path.join(drillRoot, "fresh-media"), adminInitialPassword);
    await runCoreJourney(activeServer.baseUrl, "fresh", adminInitialPassword, checks);
    await activeServer.stop();
    activeServer = null;
    const freshMetadata = await inspectDatabase(freshPath);
    const freshCatalog = inspectBundledCatalog(freshPath);
    checks.push({ name: "fresh.catalog-governance", durationMs: freshCatalog.durationMs, details: freshCatalog });

    // Build the previous-candidate fixture through the real bootstrap path, then
    // remove only migrations newer than the requested candidate boundary.
    activeServer = await startServer(legacyPath, path.join(drillRoot, "legacy-media"), adminInitialPassword);
    await request(activeServer.baseUrl, "/api/v1/health");
    await activeServer.stop();
    activeServer = null;
    const legacyDatabase = new Database(legacyPath);
    try {
      rollbackPreviousCandidateFixture(legacyDatabase, previousVersion);
    } finally {
      legacyDatabase.close();
    }
    const legacyBefore = await inspectDatabase(legacyPath);
    if (legacyBefore.migrationVersion !== previousVersion) throw new Error(`previous candidate fixture stopped at migration ${legacyBefore.migrationVersion}`);
    activeServer = await startServer(legacyPath, path.join(drillRoot, "legacy-media"), adminInitialPassword);
    const legacyJourney = await runCoreJourney(activeServer.baseUrl, "upgrade", adminInitialPassword, checks);
    const upgradedMetadata = await inspectDatabase(legacyPath);
    const upgradedCatalog = inspectBundledCatalog(legacyPath);
    checks.push({ name: "upgrade.catalog-governance", durationMs: upgradedCatalog.durationMs, details: upgradedCatalog });
    if (upgradedMetadata.migrationVersion !== freshMetadata.migrationVersion) throw new Error("upgraded database did not reach the current migration");

    const backupStartedAt = new Date();
    const backup = await createDatabaseBackup(legacyPath, backupPath);
    const backupCompletedAt = new Date();
    const marker = await request(activeServer.baseUrl, "/api/v1/inventory", {
      method: "POST",
      token: (await request(activeServer.baseUrl, "/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: legacyJourney.identifier, password: legacyJourney.password }),
      })).body.token,
      body: JSON.stringify({
        food_name: "备份后写入标记",
        category: "其他",
        quantity: "1份",
        expiration_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        storage_location: "冷藏",
      }),
    });
    const markerCreatedAt = new Date();
    checks.push({ name: "backup.cutoff-marker", durationMs: marker.durationMs, details: { createdAfterBackup: true } });
    await activeServer.stop();
    activeServer = null;

    const independentRestoreStartedAt = new Date();
    const independentRestore = await restoreDatabaseBackup(independentRecoveryPath, backupPath);
    if (independentRestore.safetyPath !== null) throw new Error("independent restore unexpectedly replaced an existing database");
    activeServer = await startServer(independentRecoveryPath, path.join(drillRoot, "legacy-media"), adminInitialPassword);
    await verifyRecoveredJourney(activeServer.baseUrl, "independent-restore", legacyJourney, checks, false);
    await activeServer.stop();
    activeServer = null;
    const independentRestoreCompletedAt = new Date();

    const restoreStartedAt = new Date();
    const restored = await restoreDatabaseBackup(legacyPath, backupPath);
    activeServer = await startServer(legacyPath, path.join(drillRoot, "legacy-media"), adminInitialPassword);
    await verifyRecoveredJourney(activeServer.baseUrl, "restore", legacyJourney, checks, false);
    await activeServer.stop();
    activeServer = null;
    const restoreCompletedAt = new Date();

    if (!restored.safetyPath) throw new Error("restore did not preserve a safety copy");
    const rollback = await restoreDatabaseBackup(legacyPath, restored.safetyPath);
    activeServer = await startServer(legacyPath, path.join(drillRoot, "legacy-media"), adminInitialPassword);
    await verifyRecoveredJourney(activeServer.baseUrl, "rollback", legacyJourney, checks, true);
    await activeServer.stop();
    activeServer = null;

    const report = {
      success: true,
      owner,
      candidateGitSha: gitSha(),
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      previousMigrationVersion: previousVersion,
      currentMigrationVersion: freshMetadata.migrationVersion,
      freshDatabase: freshMetadata,
      upgradedDatabase: upgradedMetadata,
      catalogGovernance: { fresh: freshCatalog, upgraded: upgradedCatalog },
      backup: { ...backup, startedAt: backupStartedAt.toISOString(), completedAt: backupCompletedAt.toISOString() },
      independentRestore: {
        ...independentRestore,
        startedAt: independentRestoreStartedAt.toISOString(),
        completedAt: independentRestoreCompletedAt.toISOString(),
      },
      restore: { ...restored, startedAt: restoreStartedAt.toISOString(), completedAt: restoreCompletedAt.toISOString() },
      rollback,
      rpo: {
        seconds: Math.max(0, (markerCreatedAt.getTime() - backupCompletedAt.getTime()) / 1000),
        postBackupWritesExpectedLost: 1,
      },
      rto: { seconds: (restoreCompletedAt.getTime() - restoreStartedAt.getTime()) / 1000 },
      checks,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (output) {
      const outputPath = path.resolve(output);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, { flag: "wx" });
      console.log(JSON.stringify({ success: true, report: outputPath, candidateGitSha: report.candidateGitSha }));
    } else {
      process.stdout.write(serialized);
    }
    success = true;
  } finally {
    if (activeServer) await activeServer.stop().catch(() => undefined);
    if (success && !keep) fs.rmSync(drillRoot, { recursive: true, force: true });
    else if (!success || keep) console.error(`Database drill artifacts retained at ${drillRoot}`);
  }
}

const isEntryPoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
