import { verifyInventoryPrecision } from "./helpers/inventoryPrecision.js";
import { verifyShoppingIntake } from "./helpers/shoppingIntake.js";
import { verifyFeedbackPostgres } from "./feedbackPostgresAssertions.js";
import { verifyAccountSecurityPostgres } from "./accountSecurityPostgresAssertions.js";
import { verifyOnboardingPostgres } from "./onboardingPostgresAssertions.js";
import { verifyHealthProfilePostgres } from "./healthProfilePostgresAssertions.js";
import { verifyManualDietPostgres } from "./manualDietPostgresAssertions.js";
import { verifyDiningPlanChanges, verifyHouseholdPlanProduction, verifyHouseholdPlanPreview, verifyHouseholdDining, verifyHouseholdProduction, verifyHouseholdEating, verifyHouseholdCorrections, verifyHouseholdReservations } from "./householdDiningAssertions.js";
import { verifyWeeklyRoll } from "./weeklyRollAssertions.js";
import { verifyMaintenanceFlow } from "./maintenanceFlowAssertions.js";
import { randomUUID } from "node:crypto";
import { verifyPortionReplacement } from "./replacementAllocationAssertions.js";
import { verifyMaintenanceQueue } from "./maintenanceQueueAssertions.js";
import { PostgresMaintenanceQueueRepository } from "../src/modules/planMaintenance/postgresQueueRepository.js";
import { PostgresPlanMaintenanceRepository } from "../src/modules/planMaintenance/postgresRepository.js";
import { PlanMaintenanceService } from "../src/modules/planMaintenance/service.js";
import type { SaveCookingPlanDraftInput } from "@dietdigidose/contracts";
import assert from "node:assert/strict";
import { verifyPreparedMealPrecision } from "./helpers/preparedMealPrecision.js";
import { currentDateKey, dateKeyAfterDays } from "../src/utils/date.js";
import { executionRecipeKey } from "../src/modules/recipes/execution.js";
import { recipeExecutionProof } from "../src/modules/recipes/planExecution.js";
import { executionFixture } from "./helpers/recipeExecution.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { Pool } from "pg";
import { PostgresAccessControlRepository } from "../src/modules/accessControl/postgresRepository.js";
import { AccessControlService } from "../src/modules/accessControl/service.js";
import { PostgresAiContextRepository } from "../src/modules/aiContext/postgresRepository.js";
import { AiContextService } from "../src/modules/aiContext/service.js";
import { PostgresAIConversationsRepository } from "../src/modules/aiConversations/postgresRepository.js";
import { AIConversationsService } from "../src/modules/aiConversations/service.js";
import { PostgresAIRuntimeRepository } from "../src/modules/aiRuntime/postgresRepository.js";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { PostgresAiToolDataRepository } from "../src/modules/aiToolData/postgresRepository.js";
import { AiToolDataService } from "../src/modules/aiToolData/service.js";
import { PostgresAIWriteConfirmationsRepository } from "../src/modules/aiWriteConfirmations/postgresRepository.js";
import { AIWriteConfirmationsService } from "../src/modules/aiWriteConfirmations/service.js";
import { PostgresAdminAuditRepository } from "../src/modules/adminAudit/postgresRepository.js";
import { AdminAuditService } from "../src/modules/adminAudit/service.js";
import { PostgresAdminAgentRunsRepository } from "../src/modules/adminAgentRuns/postgresRepository.js";
import { AdminAgentRunsService } from "../src/modules/adminAgentRuns/service.js";
import { PostgresAgentSchedulingRepository } from "../src/modules/agentScheduling/postgresRepository.js";
import { AgentSchedulingService } from "../src/modules/agentScheduling/service.js";
import { PostgresAgentOperationsRepository } from "../src/modules/agentOperations/postgresRepository.js";
import { AgentOperationsService } from "../src/modules/agentOperations/service.js";
import type { ExecutableAgentAction } from "../src/modules/agentOperations/repository.js";
import { createPostgresAgentCheckpointer } from "../src/modules/agentCheckpoints/postgres.js";
import { PostgresAgentRunsRepository } from "../src/modules/agentRuns/postgresRepository.js";
import { AgentRunsService } from "../src/modules/agentRuns/service.js";
import { PostgresAuthAccountRepository } from "../src/modules/authAccount/postgresRepository.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";
import { PostgresAuthVerificationRepository } from "../src/modules/authVerification/postgresRepository.js";
import { AuthVerificationService } from "../src/modules/authVerification/service.js";
import { PostgresAdminCommunityRepository } from "../src/modules/adminCommunity/postgresRepository.js";
import { PostgresAdminUsersRepository } from "../src/modules/adminUsers/postgresRepository.js";
import { AdminUsersService } from "../src/modules/adminUsers/service.js";
import { PostgresAdminConsoleRepository } from "../src/modules/adminConsole/postgresRepository.js";
import { AdminConsoleService } from "../src/modules/adminConsole/service.js";
import { PostgresAdminFoodAssetsRepository } from "../src/modules/adminFoodAssets/postgresRepository.js";
import { AdminFoodAssetsService } from "../src/modules/adminFoodAssets/service.js";
import { PostgresAdminKitchenwareRepository } from "../src/modules/adminKitchenware/postgresRepository.js";
import { AdminKitchenwareService } from "../src/modules/adminKitchenware/service.js";
import { PostgresAdminRecipesRepository } from "../src/modules/adminRecipes/postgresRepository.js";
import { AdminRecipesService } from "../src/modules/adminRecipes/service.js";
import { CookingQueueService } from "../src/modules/cookingQueue/service.js";
import { PostgresCookingQueueRepository } from "../src/modules/cookingQueue/postgresRepository.js";
import { PostgresCommunityRepository } from "../src/modules/community/postgresRepository.js";
import { CommunityService } from "../src/modules/community/service.js";
import { PostgresDietRecordsRepository } from "../src/modules/dietRecords/postgresRepository.js";
import { DietRecordsService } from "../src/modules/dietRecords/service.js";
import { PostgresFeedbackRepository } from "../src/modules/feedback/postgresRepository.js";
import { PostgresFoodRepository } from "../src/modules/foods/postgresRepository.js";
import { PostgresHealthRepository } from "../src/modules/health/postgresRepository.js";
import { PostgresHouseholdsRepository } from "../src/modules/households/postgresRepository.js";
import { HouseholdsService } from "../src/modules/households/service.js";
import { PostgresInsightsRepository } from "../src/modules/insights/postgresRepository.js";
import { InsightsService } from "../src/modules/insights/service.js";
import { consumeInventoryWithPostgresClient, PostgresInventoryRepository } from "../src/modules/inventory/postgresRepository.js";
import { InventoryService } from "../src/modules/inventory/service.js";
import { PostgresKitchenwareRepository } from "../src/modules/kitchenware/postgresRepository.js";
import { KitchenwareService } from "../src/modules/kitchenware/service.js";
import { PostgresMealPlansRepository } from "../src/modules/mealPlans/postgresRepository.js";
import { PostgresMediaCleanupRepository } from "../src/modules/mediaCleanup/postgresRepository.js";
import { MediaCleanupService } from "../src/modules/mediaCleanup/service.js";
import { PostgresNotificationsRepository } from "../src/modules/notifications/postgresRepository.js";
import { createNotificationsService } from "../src/modules/notifications/service.js";
import { PostgresRateLimitsRepository } from "../src/modules/rateLimits/postgresRepository.js";
import { RateLimitsService } from "../src/modules/rateLimits/service.js";
import { PostgresRecommendationsRepository } from "../src/modules/recommendations/postgresRepository.js";
import { RecommendationsService } from "../src/modules/recommendations/service.js";
import { PostgresRealtimeVoiceRepository } from "../src/modules/realtimeVoice/postgresRepository.js";
import { RealtimeVoiceService } from "../src/modules/realtimeVoice/service.js";
import { PostgresRecipesRepository } from "../src/modules/recipes/postgresRepository.js";
import { RecipesService } from "../src/modules/recipes/service.js";
import { PostgresShoppingRepository } from "../src/modules/shopping/postgresRepository.js";
import { PostgresVoicePacksRepository } from "../src/modules/voicePacks/postgresRepository.js";
import { VoicePacksService } from "../src/modules/voicePacks/service.js";
import { PostgresWorkerRepository } from "../src/modules/worker/postgresRepository.js";
import { WorkerRuntime } from "../src/modules/worker/service.js";
import {
  exportMigrationArchive,
  importMigrationArchive,
  validateMigrationTarget,
  type BaselineManifest,
} from "../src/storage/database/postgres/migration.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.POSTGRES_MIGRATION_TEST_URL?.trim();
if (!connectionString) throw new Error("POSTGRES_MIGRATION_TEST_URL is required");
const baseline = JSON.parse(fs.readFileSync(
  path.join(serverRoot, "src", "storage", "database", "postgres", "baseline-manifest.json"),
  "utf8",
)) as BaselineManifest;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-postgres-integration-"));
const sqlitePath = path.join(temporaryDirectory, "source.db");
const archiveDirectory = path.join(temporaryDirectory, "archive");

process.env.ADMIN_INITIAL_PASSWORD = "integration-only-not-a-secret-1234";
process.env.DATABASE_PATH = sqlitePath;
process.env.ENABLE_DEMO_SEED = "0";
process.env.NODE_ENV = "test";

const sqliteModule = await import("../src/storage/db.js");
sqliteModule.initDatabase();
const user = sqliteModule.db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number };
sqliteModule.db.prepare(`
  INSERT INTO inventory_items
    (user_id, food_name, category, quantity, expiration_date, quantity_value, quantity_unit, is_available)
  VALUES (?, '番茄', '蔬菜', '250g', '2026-09-10', 250, 'g', 1)
`).run(user.id);
sqliteModule.db.prepare(`
  INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, recorded_at)
  VALUES (?, 'lunch', '番茄', '250g', 45, '2026-09-01')
`).run(user.id);
sqliteModule.db.prepare(`
  INSERT INTO health_logs (user_id, weight, recorded_date) VALUES (?, 62.5, '2026-09-01')
`).run(user.id);
sqliteModule.db.prepare(`
  INSERT INTO ai_usage_logs (user_id, endpoint, model, total_tokens, success)
  VALUES (?, '/integration', 'test-model', 321, 1)
`).run(user.id);
sqliteModule.db.prepare(`INSERT INTO agent_runs
  (id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
  VALUES ('sqlite-checkpoint-run',?,'sqlite-checkpoint-session','text','assistant','awaiting_approval',
    '{"prompt":"迁移 checkpoint"}','sqlite-checkpoint-thread')`).run(user.id);
const sqliteCheckpointer = new SqliteSaver(sqliteModule.db);
const sqliteCheckpointConfig = await sqliteCheckpointer.put(
  { configurable: { thread_id: "sqlite-checkpoint-thread", checkpoint_ns: "" } },
  {
    v: 4, id: "00000000-0000-6000-8000-000000000000", ts: new Date(0).toISOString(),
    channel_values: { goal: "从 SQLite 恢复", typedBytes: new Uint8Array([0, 1, 255]) },
    channel_versions: { goal: "1", typedBytes: "1" }, versions_seen: {},
  },
  { source: "input", step: 0, parents: {} },
);
const sqliteChildCheckpointConfig = await sqliteCheckpointer.put(
  sqliteCheckpointConfig,
  {
    v: 4, id: "00000000-0000-6000-8000-000000000001", ts: new Date(1).toISOString(),
    channel_values: { goal: "从 SQLite 恢复完成", typedBytes: new Uint8Array([0, 1, 255, 2]) },
    channel_versions: { goal: "2", typedBytes: "2" }, versions_seen: { supervisor: { goal: "1" } },
  },
  { source: "loop", step: 1, parents: {} },
);
await sqliteCheckpointer.putWrites(sqliteChildCheckpointConfig, [["approval", { approved: false }]], "sqlite-task");
sqliteModule.db.close();

const source = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const archive = exportMigrationArchive({ database: source, sqlitePath, outputDirectory: archiveDirectory, baseline });
source.close();

const pool = new Pool({ connectionString, max: 6 });
try {
  const existing = await pool.query(`
    SELECT COUNT(*)::integer AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  assert.equal(existing.rows[0]?.count, 0, "PostgreSQL migration integration database must be empty");

  const legacyQueueClient = await pool.connect();
  try {
    await legacyQueueClient.query("BEGIN");
    await legacyQueueClient.query(`CREATE TEMP TABLE cooking_queue_items(id text PRIMARY KEY,user_id integer,recipe_id integer,status text,
      deleted_at timestamp,recipe_snapshot_json jsonb,version integer,updated_at timestamp);
      CREATE UNIQUE INDEX idx_cooking_queue_active_recipe ON cooking_queue_items(user_id,recipe_id);
      CREATE TEMP TABLE meal_plan_items(id text PRIMARY KEY,user_id integer,queue_item_id text,status text,
        deleted_at timestamp,version integer,updated_at timestamp,ingredients_json jsonb,planned_date text);
      INSERT INTO cooking_queue_items VALUES('q',1,10,'cooking',NULL,'{}',4,NULL);
      INSERT INTO meal_plan_items VALUES('a',1,'q','queued',NULL,2,NULL,'[{"name":"蛋","amount":"6个"}]','2026-09-10');
      INSERT INTO meal_plan_items VALUES('b',1,'q','queued',NULL,3,NULL,'[]','2026-09-11');`);
    await legacyQueueClient.query(fs.readFileSync(path.join(serverRoot, "drizzle/0004_chief_loki.sql"), "utf8"));
    const legacyQueue = (await legacyQueueClient.query("SELECT * FROM cooking_queue_items")).rows[0];
    assert.equal(legacyQueue.source_plan_item_id, "a");
    assert.equal(legacyQueue.status, "cooking");
    assert.equal(legacyQueue.version, 5);
    assert.deepEqual(legacyQueue.recipe_snapshot_json.ingredients, [{ name: "蛋", amount: "6个" }]);
    assert.deepEqual((await legacyQueueClient.query("SELECT queue_item_id,status,version FROM meal_plan_items WHERE id='b'")).rows[0],
      { queue_item_id: null, status: "planned", version: 4 });
  } finally {
    await legacyQueueClient.query("ROLLBACK");
    legacyQueueClient.release();
  }

  const legacyBaseData = await pool.connect();
  try {
    await legacyBaseData.query("BEGIN");
    await legacyBaseData.query(`
      CREATE SCHEMA base_data;
      CREATE TABLE base_data.runtime_ids(collection text,logical_id text,target_table text,target_id text,
        imported_version text,imported_at timestamptz);
      INSERT INTO base_data.runtime_ids VALUES('recipes','stable-recipe','recipes','7','0.1.0-rc.7',now());
      CREATE TABLE public.recipes(id integer PRIMARY KEY,title text,
        automatic_inventory_write_allowed boolean NOT NULL DEFAULT true,base_data_payload jsonb);
      INSERT INTO public.recipes VALUES(7,'管理员已修改',false,'{"admin_edit":true}');
      CREATE TABLE public.ingredients_library(id integer PRIMARY KEY,calories_100g double precision,
        nutrition_status text NOT NULL DEFAULT 'unspecified',base_data_payload jsonb);
      INSERT INTO public.ingredients_library VALUES(1,NULL,'unknown','{"name":"未知营养"}');
      CREATE TABLE public.kitchenware_catalog(id integer PRIMARY KEY,base_data_payload jsonb);
      CREATE TABLE public.cooking_completions(id text PRIMARY KEY,recipe_id integer REFERENCES public.recipes(id));
      CREATE TABLE public.prepared_meals(id text PRIMARY KEY,recipe_id integer REFERENCES public.recipes(id));
      CREATE TABLE public.users(id integer PRIMARY KEY,is_demo boolean NOT NULL DEFAULT false);
      CREATE TABLE public.community_posts(id integer PRIMARY KEY,is_demo boolean NOT NULL DEFAULT false);
      CREATE TABLE public.community_comments(id integer PRIMARY KEY,is_demo boolean NOT NULL DEFAULT false);
      CREATE TABLE public.inventory_items(id integer PRIMARY KEY,is_demo boolean NOT NULL DEFAULT false);
      CREATE TABLE public.recipe_favorites(id integer PRIMARY KEY,is_demo boolean NOT NULL DEFAULT false);
    `);
    await legacyBaseData.query(fs.readFileSync(path.join(serverRoot, "drizzle/0023_good_wild_pack.sql"), "utf8"));
    assert.deepEqual((await legacyBaseData.query("SELECT title,base_data_payload,automatic_inventory_write_allowed FROM public.recipes")).rows,
      [{ title: "管理员已修改", base_data_payload: { admin_edit: true }, automatic_inventory_write_allowed: false }]);
    assert.deepEqual((await legacyBaseData.query("SELECT logical_id,target_id FROM public.base_data_runtime_ids")).rows,
      [{ logical_id: "stable-recipe", target_id: "7" }]);
    assert.equal((await legacyBaseData.query("SELECT calories_100g FROM public.ingredients_library")).rows[0].calories_100g, null);
    await legacyBaseData.query("SAVEPOINT reference_only");
    await assert.rejects(() => legacyBaseData.query("INSERT INTO public.cooking_completions VALUES('blocked',7)"), /reference-only/);
    await legacyBaseData.query("ROLLBACK TO SAVEPOINT reference_only");
    await assert.rejects(() => legacyBaseData.query("INSERT INTO public.prepared_meals VALUES('blocked',7)"), /reference-only/);
    await legacyBaseData.query("ROLLBACK TO SAVEPOINT reference_only");
  } finally {
    await legacyBaseData.query("ROLLBACK");
    legacyBaseData.release();
  }

  const legacyAllocations = await pool.connect();
  try {
    await legacyAllocations.query("BEGIN");
    await legacyAllocations.query(`CREATE TABLE users(id integer PRIMARY KEY); INSERT INTO users VALUES(1),(2);
      CREATE TABLE meal_plans(id text PRIMARY KEY,user_id integer,status text,deleted_at text,constraints_json jsonb);
      CREATE TABLE prepared_meals(id text PRIMARY KEY,user_id integer,remaining_servings double precision,version integer,is_reserved boolean);
      INSERT INTO prepared_meals VALUES('b1',1,1,1,false),('b2',1,2,1,false);`);
    for (const [id,owner,batch] of [["p1",1,"b1"],["p2",1,"b1"],["p3",2,"b2"],["p4",1,"b2"],["p5",1,"missing"]]) {
      const source = { savedCookingDraft: { draft: { meals: [{ id: "dinner",date: "2099-09-10",mealType: "dinner",allocations: [{ preparedMealId: batch,version: 1,servings: 1 }] }] } } };
      await legacyAllocations.query("INSERT INTO meal_plans VALUES($1,$2,'active',NULL,$3::jsonb)",[id,owner,JSON.stringify(source)]);
    }
    await legacyAllocations.query(fs.readFileSync(path.join(serverRoot,"drizzle/0024_awesome_guardian.sql"),"utf8"));
    assert.deepEqual((await legacyAllocations.query("SELECT plan_id,status FROM prepared_meal_allocations ORDER BY plan_id")).rows,[
      { plan_id: "p1",status: "conflict" },{ plan_id: "p2",status: "conflict" },{ plan_id: "p3",status: "conflict" },
      { plan_id: "p4",status: "active" },{ plan_id: "p5",status: "conflict" },
    ]);
    assert.equal(Number((await legacyAllocations.query("SELECT remaining_servings FROM prepared_meals WHERE id='b1'")).rows[0].remaining_servings),1);
  } finally { await legacyAllocations.query("ROLLBACK"); legacyAllocations.release(); }

  await migrate(drizzle(pool), { migrationsFolder: path.join(serverRoot, "drizzle") });
  const first = await pool.connect();
  try {
    await importMigrationArchive(first, archiveDirectory, baseline);
    await importMigrationArchive(first, archiveDirectory, baseline);
  } finally {
    first.release();
  }

  const concurrentClients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    await Promise.all(concurrentClients.map((client) => importMigrationArchive(client, archiveDirectory, baseline)));
  } finally {
    concurrentClients.forEach((client) => client.release());
  }

  const validationClient = await pool.connect();
  let report;
  try {
    report = await validateMigrationTarget(validationClient, archiveDirectory, baseline);
  } finally {
    validationClient.release();
  }
  assert.equal(report.ok, true, report.failures.join("\n"));
  assert.equal(report.tableCount, baseline.tables.length);
  assert.equal(report.criticalMetrics["inventory.quantity_value"], 250);
  assert.equal(report.criticalMetrics["diet.calories"], 45);
  assert.equal(report.criticalMetrics["health.weight"], 62.5);
  assert.equal(report.criticalMetrics["ai.total_tokens"], 321);
  assert.deepEqual(report.langgraph, {
    sourcePresent: true, checkpointCount: 2, checkpointBlobCount: 4, checkpointWriteCount: 1,
  });
  const migratedCheckpointSaver = await createPostgresAgentCheckpointer(pool);
  const migratedCheckpoint = await migratedCheckpointSaver.getTuple({
    configurable: { thread_id: "sqlite-checkpoint-thread", checkpoint_ns: "" },
  });
  assert.equal(migratedCheckpoint?.checkpoint.channel_values.goal, "从 SQLite 恢复完成");
  assert.deepEqual(Array.from(migratedCheckpoint?.checkpoint.channel_values.typedBytes as Uint8Array), [0, 1, 255, 2]);
  assert.equal(migratedCheckpoint?.parentConfig?.configurable?.checkpoint_id,
    "00000000-0000-6000-8000-000000000000");
  assert.deepEqual(migratedCheckpoint?.pendingWrites, [["sqlite-task", "approval", { approved: false }]]);

  const inventoryRepository = new PostgresInventoryRepository(pool);
  const inventoryService = new InventoryService(inventoryRepository);
  await (await import("./helpers/savedInventoryEvidence.js")).verifySavedInventoryEvidence(inventoryRepository, user.id, -1, async (id, mode) => {
    if (mode === "gap") { await pool.query("DELETE FROM inventory_change_logs WHERE inventory_item_id=$1 AND id NOT IN (SELECT MAX(id) FROM inventory_change_logs WHERE inventory_item_id=$1)", [id]); return; }
    await pool.query("UPDATE inventory_change_logs SET metadata_json='[null]'::jsonb WHERE inventory_item_id=$1", [id]);
  });
  const funnelBefore = await pool.query(`SELECT event_name,COUNT(*)::int AS count FROM funnel_events
    WHERE event_name IN ('inventory_added','cooking_completed') GROUP BY event_name`);
  const initialFunnelCounts = new Map(funnelBefore.rows.map((row) => [String(row.event_name), Number(row.count)]));
  const migratedItems = await inventoryRepository.list(user.id);
  const migratedTomato = migratedItems.find((item) => item.food_name === "番茄")!;
  assert.equal(migratedTomato.quantity_value, 250);
  const created = await inventoryService.create(user.id, {
    food_name: "牛奶",
    category: "乳制品",
    quantity: "500ml",
    expiration_date: "2026-09-08",
    storage_location: "冷藏",
    quantity_value: 500,
    quantity_unit: "ml",
  });
  const imported = await Promise.all([0, 1].map(() => inventoryService.importShoppingList(user.id, {
    idempotency_key: "postgres-concurrent-import-0001",
    items: [{
      food_name: "土豆",
      category: "蔬菜",
      quantity: "2piece",
      expiration_date: "2026-09-15",
      storage_location: "常温",
      quantity_value: 2,
      quantity_unit: "piece",
    }],
  })));
  assert.deepEqual(imported.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(imported[0]!.items[0]!.id, imported[1]!.items[0]!.id);
  const importedHistory = await inventoryService.history(user.id,imported[0]!.items[0]!.id);
  assert.equal(importedHistory.filter(event => event.action === "created").length,1);
  assert.equal(importedHistory.find(event => event.action === "created")?.source,"manual");
  const consumed = await inventoryRepository.consume(user.id, {
    idempotency_key: "postgres-consume-0001",
    source: "cooking",
    items: [{ item_id: migratedTomato.id, version: migratedTomato.version, mode: "amount", amount_value: 50, unit: "g" }],
  });
  assert.equal(consumed.items[0]!.quantity_value, 200);
  const repeatedConsumption = await inventoryRepository.consume(user.id, {
    idempotency_key: "postgres-consume-0001",
    source: "cooking",
    items: [{ item_id: migratedTomato.id, version: migratedTomato.version, mode: "amount", amount_value: 50, unit: "g" }],
  });
  assert.equal(repeatedConsumption.repeated, true);
  assert.equal(repeatedConsumption.items[0]!.quantity_value, 200);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE user_id=$1 AND source_id LIKE 'consume:postgres-consume-0001:%'",[user.id])).rows[0].n,1);
  await assert.rejects(() => inventoryRepository.consume(user.id,{ idempotency_key: "postgres-consume-rollback",source: "manual",
    items: [0,1].map(() => ({ item_id: migratedTomato.id,version: consumed.items[0]!.version,mode: "amount" as const,amount_value: 1,unit: "g" as const })) }));
  assert.equal((await inventoryRepository.findOwned(user.id,migratedTomato.id))?.quantity_value,200);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE user_id=$1 AND source_id LIKE 'consume:postgres-consume-rollback:%'",[user.id])).rows[0].n,0);
  const updated = await inventoryRepository.update(user.id, created.id, created.version, {
    nextQuantityValue: 500,
    nextQuantityUnit: "ml",
    patch: { storage_location: "冷冻", version: created.version },
  });
  assert.equal(updated.kind, "updated");
  if (updated.kind === "updated") assert.equal(updated.item.storage_location, "冷冻");
  const history = await inventoryRepository.history(user.id, migratedTomato.id);
  assert(history?.some((entry) => entry.action === "consume_partial"));
  assert.deepEqual(await inventoryRepository.remove(user.id, created), { kind: "removed" });

  const inventoryChanges = (await pool.query("SELECT details_json FROM plan_maintenance_events WHERE user_id=$1 AND subject_id=$2 AND event_type='inventory_changed'",[user.id,String(created.id)])).rows;
  assert.deepEqual(inventoryChanges.map(row => row.details_json.mode).sort(),["remove","update"]);
  assert.equal(inventoryChanges.find(row => row.details_json.mode === "update").details_json.previousFoodName,created.food_name);
  const unknownExpiry = await inventoryRepository.create(user.id, {
    food_name: "未知日期大米", category: "粮油干货", quantity: "一袋", expiration_date: "", storage_location: "常温",
  });
  const unknownSaved = (await inventoryRepository.list(user.id)).find(item => Number(item.id) === unknownExpiry.id)!;
  assert.equal(unknownSaved.expiration_date, "");
  assert.equal(unknownSaved.quantity_value, null);
  assert.equal((await pool.query("SELECT COUNT(*)::integer n FROM inventory_items WHERE id=$1 AND expiration_date >= '2026-09-09' AND expiration_date <= '2026-09-12'", [unknownExpiry.id])).rows[0].n, 0);
  await inventoryRepository.remove(user.id, unknownExpiry);

  const autoResults = await Promise.all(["one", "two"].map(key => inventoryRepository.bulkIntake(user.id, {
    idempotency_key: `pg-automatic-scan-${key}`, source: "image", source_reference: `pg-auto-job-${key}`,
    items: [{ food_name: "自动入库并发米", category: "其他", quantity: "1袋", expiration_date: "", storage_location: "常温",
      confirmed: false, source: "image", source_item_id: `pg-auto-job-${key}:0` }],
  }, "inventory-scan-v1")));
  assert.deepEqual(autoResults.map(result => result.items.length).sort(), [0, 1]);
  const restoredAuto = await Promise.all(["one", "two"].map(key => inventoryRepository.savedScanItems(user.id, `pg-auto-job-${key}`)));
  assert.deepEqual(restoredAuto.map(items => items.size).sort(), [0, 1]);
  for (let index = 0; index < restoredAuto.length; index++) {
    if (restoredAuto[index]!.size) assert(restoredAuto[index]!.has(`pg-auto-job-${index === 0 ? "one" : "two"}:0`));
  }
  const autoItem = autoResults.flatMap(result => result.items)[0]!;
  const autoLog = (await pool.query("SELECT metadata_json FROM inventory_change_logs WHERE inventory_item_id=$1", [autoItem.id])).rows[0];
  assert.equal(autoLog.metadata_json.acceptance, "automatic");
  const winningJob = `pg-auto-job-${restoredAuto[0]!.size ? "one" : "two"}`;
  const undoResults = await Promise.all([inventoryRepository.undoScan(user.id, winningJob), inventoryRepository.undoScan(user.id, winningJob)]);
  assert.deepEqual(undoResults.map(result => result.undone).sort(), [0, 1]);
  assert.deepEqual(await inventoryRepository.undoneScanItemIds(user.id, winningJob), [autoItem.id]);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE user_id=$1 AND subject_id=$2 AND event_type='inventory_changed'",[user.id,String(autoItem.id)])).rows[0].n,1);
  const conflictBatch = await inventoryRepository.bulkIntake(user.id, { idempotency_key: "pg-undo-conflict-batch", source: "image", source_reference: "pg-undo-conflict",
    items: [0,1].map(index => ({ source_item_id: `pg-undo-conflict:${index}`, food_name: `PG撤销冲突${index}`, category: "其他", quantity: "2个", quantity_value: 2,
      quantity_unit: "piece" as const, expiration_date: "", storage_location: "常温" as const, source: "image" as const, confirmed: true })) });
  await inventoryRepository.update(user.id, conflictBatch.items[1]!.id, 1, { patch: { quantity: "1个" }, nextQuantityValue: 1, nextQuantityUnit: "piece" });
  await assert.rejects(() => inventoryRepository.undoScan(user.id, "pg-undo-conflict"), /整批未撤销/);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE user_id=$1 AND source_id LIKE 'intake-undo:pg-undo-conflict:%'",[user.id])).rows[0].n,0);
  const conflictRows = (await pool.query("SELECT version,deleted_at,quantity_value FROM inventory_items WHERE id=ANY($1::integer[]) ORDER BY id", [conflictBatch.items.map(item => item.id)])).rows;
  assert.equal(conflictRows[0].version, 1);
  assert(conflictRows.every(row => row.deleted_at === null));
  for (const original of conflictBatch.items) {
    const current = await inventoryRepository.findOwned(user.id,original.id);
    if (current) await inventoryRepository.remove(user.id,current);
  }


  const dietInventory = await inventoryRepository.create(user.id, {
    food_name: "烹饪事务土豆",
    category: "蔬菜",
    quantity: "400g",
    expiration_date: "2026-09-12",
    storage_location: "常温",
    quantity_value: 400,
    quantity_unit: "g",
  });
  const dietRepository = new PostgresDietRecordsRepository(pool, consumeInventoryWithPostgresClient);
  const dietService = new DietRecordsService(dietRepository);
  const completionInput = {
    idempotency_key: "postgres-cooking-completion-0001",
    recipe_id: null,
    inventory_item_ids: [],
    inventory_consumptions: [{
      item_id: dietInventory.id,
      version: dietInventory.version,
      mode: "amount" as const,
      amount_value: 125,
      unit: "g" as const,
    }],
    diet_record: {
      meal_type: "晚餐",
      food_name: "Postgres 土豆料理",
      amount: "1份",
      calories: 280,
      recorded_at: "2026-09-03",
      recorded_time: "19:30",
    },
  };
  const cookingCompletions = await Promise.all([
    dietService.completeCooking(user.id, completionInput),
    dietService.completeCooking(user.id, completionInput),
  ]);
  assert.deepEqual(cookingCompletions.map((result) => result.repeated).sort(), [false, true]);
  const completionRecordIds = cookingCompletions.map((result) => Number((result.diet_record as { id: number }).id));
  assert.equal(completionRecordIds[0], completionRecordIds[1]);
  const storedDietInventory = await inventoryRepository.findOwned(user.id, dietInventory.id);
  assert.equal(storedDietInventory?.quantity_value, 275);
  const completedMeals = await dietRepository.list(user.id, "2026-09-03");
  assert.equal(completedMeals.filter((record) => record.food_name === "Postgres 土豆料理").length, 1);
  const funnelAfter = await pool.query(`SELECT event_name,COUNT(*)::int AS count FROM funnel_events
    WHERE event_name IN ('inventory_added','cooking_completed') GROUP BY event_name`);
  const finalFunnelCounts = new Map(funnelAfter.rows.map((row) => [String(row.event_name), Number(row.count)]));
  assert.equal((finalFunnelCounts.get("inventory_added")||0)-(initialFunnelCounts.get("inventory_added")||0),2);
  assert.equal((finalFunnelCounts.get("cooking_completed")||0)-(initialFunnelCounts.get("cooking_completed")||0),1);
  const manualDietRecord = await dietRepository.create(user.id, {
    meal_type: "加餐",
    food_name: "Postgres 酸奶",
    amount: "1杯",
    calories: 95,
    recorded_at: "2026-09-04",
    recorded_time: null,
  });
  assert.equal(await dietRepository.remove(user.id + 1, Number(manualDietRecord.id)), false);
  assert.equal(await dietRepository.remove(user.id, Number(manualDietRecord.id)), true);

  const production = await dietService.completeCooking(user.id, {
    idempotency_key: "postgres-prepared-production-190", inventory_item_ids: [], inventory_consumptions: [],
    production: { food_name: "Postgres 三份待吃餐", reported_cooking_minutes: 27, produced_servings: 3, eaten_servings: 1,
      meal_type: "晚餐", eaten_at: "2026-09-08", nutrition_per_serving: { calories: 100, protein: null } },
  });
  const prepared = production.prepared_meal as { id: string; remaining_servings: number };
  assert.equal(prepared.remaining_servings, 2);
  assert.equal((production.prepared_meal as { reported_cooking_minutes: number }).reported_cooking_minutes,27);
  const halfMeal = { idempotency_key: "postgres-prepared-half-190", version: 1, type: "eat" as const,
    servings: 0.5, recorded_at: "2026-09-09" };
  const halves = await Promise.all([dietService.applyMealEvent(user.id, prepared.id, halfMeal), dietService.applyMealEvent(user.id, prepared.id, halfMeal)]);
  assert.deepEqual(halves.map(result => result.repeated).sort(), [false, true]);
  const halfRecord = halves[0].diet_record as { calories: number; protein: number | null };
  assert.equal(halfRecord.calories, 50);
  assert.equal(halfRecord.protein, null);
  for (const changed of [{ type: "discard" as const }, { servings: 1 }, { version: 2 }, { recorded_at: "2026-09-10" }]) {
    await assert.rejects(dietService.applyMealEvent(user.id, prepared.id, { ...halfMeal, ...changed }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PREPARED_MEAL_KEY_CONFLICT");
  }
  assert.equal((await dietService.listPreparedMeals(user.id)).find(meal => meal.id === prepared.id)?.remaining_servings, 1.5);

  const discardedMeal = await dietService.applyMealEvent(user.id, prepared.id, {
    idempotency_key: "postgres-prepared-discard-190", version: 2, type: "discard", servings: 0.5,
  });
  assert.equal(discardedMeal.diet_record, null);
  const raceMeals = await Promise.allSettled(["a", "b"].map(key => dietService.applyMealEvent(user.id, prepared.id, {
    idempotency_key: `postgres-prepared-race-190-${key}`, version: 3, type: "eat", servings: 1, recorded_at: "2026-09-10",
  })));
  assert.equal(raceMeals.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await dietService.listPreparedMeals(user.id)).find(meal => meal.id === prepared.id)?.remaining_servings, 0);

  const maintenanceEvents = await pool.query("SELECT event_type FROM plan_maintenance_events WHERE user_id=$1 AND subject_id=$2 ORDER BY event_type",[user.id,prepared.id]);
  assert.deepEqual(maintenanceEvents.rows.map(row => row.event_type), ["discard","eat","eat","production"]);
  const outboxClient = await pool.connect();
  try {
    await outboxClient.query("BEGIN");
    const uncommitted = await dietRepository.completeCookingWithClient(outboxClient,user.id, {
      idempotency_key: "outbox-rollback-test", inventory_item_ids: [], inventory_consumptions: [],
      production: { food_name: "Rollback outbox", produced_servings: 1, eaten_servings: 0, meal_type: "午餐", nutrition_per_serving: {} },
    });
    const uncommittedMeal = uncommitted.prepared_meal as { id: string };
    assert.equal((await outboxClient.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE subject_id=$1",[uncommittedMeal.id])).rows[0].n,1);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE subject_id=$1",[uncommittedMeal.id])).rows[0].n,0);
    await outboxClient.query("ROLLBACK");
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE subject_id=$1",[uncommittedMeal.id])).rows[0].n,0);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM prepared_meals WHERE id=$1",[uncommittedMeal.id])).rows[0].n,0);
  } finally { await outboxClient.query("ROLLBACK"); outboxClient.release(); }

  await verifyPreparedMealPrecision(dietService, user.id);

  const correctProduction = await dietService.completeCooking(user.id, {
    idempotency_key: "postgres-correction-produce-203", inventory_item_ids: [], inventory_consumptions: [],
    production: { food_name: "Postgres 纠错饭", produced_servings: 3, eaten_servings: 1, meal_type: "午餐", nutrition_per_serving: {} },
  });
  const correctMeal = correctProduction.prepared_meal as { id: string };
  const correctRecord = correctProduction.diet_record as { id: number };
  await assert.rejects(dietService.remove(user.id, correctRecord.id), /选择/);
  await pool.query(`CREATE FUNCTION fail_intake_correction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected correction failure'; END $$;
    CREATE TRIGGER fail_intake_correction BEFORE INSERT ON prepared_meal_intake_corrections FOR EACH ROW EXECUTE FUNCTION fail_intake_correction();`);
  try { await assert.rejects(dietService.remove(user.id, correctRecord.id, "undo_eating"), /injected/); }
  finally { await pool.query("DROP TRIGGER fail_intake_correction ON prepared_meal_intake_corrections; DROP FUNCTION fail_intake_correction()"); }
  assert.equal((await dietService.listPreparedMeals(user.id)).find(meal => meal.id === correctMeal.id)?.remaining_servings, 2);
  assert.deepEqual(await Promise.all([dietService.remove(user.id, correctRecord.id, "undo_eating"), dietService.remove(user.id, correctRecord.id, "undo_eating")]), [true, true]);
  assert.equal((await dietService.listPreparedMeals(user.id)).find(meal => meal.id === correctMeal.id)?.remaining_servings, 3);
  const correctionEat = await dietService.applyMealEvent(user.id, correctMeal.id, { idempotency_key: "postgres-correction-eat-203", version: 2, type: "eat", servings: 1 });
  await dietService.applyMealEvent(user.id, correctMeal.id, { idempotency_key: "postgres-correction-later-203", version: 3, type: "discard", servings: 1 });
  const laterRecordId = Number((correctionEat.diet_record as { id: number }).id);
  await assert.rejects(dietService.remove(user.id, laterRecordId, "undo_eating"), /其他变更/);
  assert.equal(await dietService.remove(user.id, laterRecordId, "delete_intake"), true);
  assert.equal((await dietService.listPreparedMeals(user.id)).find(meal => meal.id === correctMeal.id)?.remaining_servings, 1);

  const intakeItem = { field_evidence: { quantity: { status: "estimated" as const, source: "recognition" as const } }, source_item_id: "postgres-scan:0", food_name: "PG 恢复入库米", category: "粮油干货",
    quantity: "1袋", quantity_value: 1, quantity_unit: "bag" as const, expiration_date: "2026-10-01", storage_location: "常温" as const, source: "image" as const, confirmed: true };
  const concurrentSourceIntakes = await Promise.all(["a", "b"].map(key => inventoryRepository.bulkIntake(user.id, {
    idempotency_key: `postgres-source-intake-191-${key}`, source: "image", source_reference: "postgres-scan", items: [intakeItem],
  })));
  assert.deepEqual(concurrentSourceIntakes.map(result => result.repeated).sort(), [false, true]);
  assert.equal(concurrentSourceIntakes[0].items[0].id, concurrentSourceIntakes[1].items[0].id);
  const partialIntake = await inventoryRepository.bulkIntake(user.id, {
    idempotency_key: "postgres-source-intake-191-partial", source: "image", source_reference: "postgres-scan",
    items: [intakeItem, { ...intakeItem, source_item_id: "postgres-scan:1" }],
  });
  assert.equal(partialIntake.items[0].id, concurrentSourceIntakes[0].items[0].id);
  assert.notEqual(partialIntake.items[0].id, partialIntake.items[1].id);
  const intakeEvidence = await pool.query("SELECT metadata_json FROM inventory_change_logs WHERE inventory_item_id=$1 AND action='created'", [partialIntake.items[0].id]);
  assert.equal(intakeEvidence.rows.length, 1);
  assert.deepEqual(intakeEvidence.rows[0].metadata_json.field_evidence.quantity, { status: "estimated", source: "recognition" });
  assert.equal((await inventoryRepository.listPreviewCandidates(user.id)).find(item => item.id === partialIntake.items[0].id)?.quantity_evidence_status, "estimated");
  assert.equal((await new PostgresRecommendationsRepository(pool).inventory(user.id)).find(item => Number(item.id) === partialIntake.items[0].id)?.quantity_evidence_status, "estimated");
  const evidenceItemId = partialIntake.items[0].id;
  await inventoryService.update(user.id, evidenceItemId, { version: 1, storage_location: "冷冻" });
  assert.equal((await inventoryRepository.listPreviewCandidates(user.id)).find(item => item.id === evidenceItemId)?.quantity_evidence_status, "estimated");
  await inventoryService.consume(user.id, { idempotency_key: "evidence-consume-pg-001", source: "manual",
    items: [{ item_id: evidenceItemId, version: 2, mode: "amount", amount_value: 0.25, unit: "bag" }] });
  assert.equal((await inventoryRepository.listPreviewCandidates(user.id)).find(item => item.id === evidenceItemId)?.quantity_evidence_status, "estimated");
  await inventoryService.update(user.id, evidenceItemId, { version: 3, quantity: "2袋", quantity_value: 2, quantity_unit: "bag" });
  assert.equal((await inventoryRepository.listPreviewCandidates(user.id)).find(item => item.id === evidenceItemId)?.quantity_evidence_status, "known");
  await inventoryService.update(user.id, evidenceItemId, { version: 4, storage_location: "常温" });
  assert.equal((await inventoryRepository.listPreviewCandidates(user.id)).find(item => item.id === evidenceItemId)?.quantity_evidence_status, "known");
  await pool.query("UPDATE inventory_items SET version=version+1 WHERE id=$1", [partialIntake.items[0].id]);
  assert.equal((await inventoryRepository.listPreviewCandidates(user.id)).find(item => item.id === partialIntake.items[0].id)?.quantity_evidence_status, "unknown");

  const insightInventory = await inventoryRepository.create(user.id, {
    food_name: "Postgres 周报菠菜",
    category: "蔬菜",
    quantity: "500g",
    expiration_date: "2026-09-03",
    storage_location: "冷藏",
    quantity_value: 500,
    quantity_unit: "g",
  });
  await inventoryRepository.create(user.id, {
    food_name: "Postgres 临期西兰花",
    category: "蔬菜",
    quantity: "1个",
    expiration_date: "2026-09-02",
    storage_location: "冷藏",
    quantity_value: 1,
    quantity_unit: "piece",
  });
  const insightsRepository = new PostgresInsightsRepository(pool);
  const outcomeInput = {
    scope: "personal" as const,
    itemId: insightInventory.id,
    itemVersion: insightInventory.version,
    outcome: "used" as const,
    source: "reminder",
    idempotencyKey: "postgres-insights-outcome-0001",
    occurredAt: "2026-09-01T10:00:00.000Z",
    closeItem: true,
  };
  const outcomeResults = await Promise.all([
    insightsRepository.createOutcome(user.id, outcomeInput),
    insightsRepository.createOutcome(user.id, outcomeInput),
  ]);
  assert.deepEqual(outcomeResults.map((result) => result.kind).sort(), ["created", "repeated"]);
  const createdOutcome = outcomeResults.find((result) => result.kind === "created");
  if (!createdOutcome || createdOutcome.kind !== "created") throw new Error("PostgreSQL outcome was not created");
  const closedInsightInventory = await pool.query(
    "SELECT is_available, version, deleted_at FROM inventory_items WHERE id = $1",
    [insightInventory.id],
  );
  assert.equal(closedInsightInventory.rows[0]?.is_available, false);
  assert.equal(Number(closedInsightInventory.rows[0]?.version), insightInventory.version + 1);
  assert(closedInsightInventory.rows[0]?.deleted_at);
  assert.equal((await insightsRepository.updateOutcome(user.id + 1, createdOutcome.event.id, { version: 1, outcome: "gifted" })).kind, "not_found");
  assert.equal((await insightsRepository.updateOutcome(user.id, createdOutcome.event.id, { version: 1, outcome: "gifted" })).kind, "updated");
  assert.equal((await insightsRepository.updateOutcome(user.id, createdOutcome.event.id, { version: 1, outcome: "expired" })).kind, "conflict");
  const insightsService = new InsightsService(insightsRepository);
  const weeklyInsights = await insightsService.weekly(user.id, {
    weekStart: "2026-08-31",
    timezoneOffsetMinutes: 0,
    scope: "personal",
  });
  assert.equal(weeklyInsights.summary.giftedOrTransferredCount, 1);
  assert.equal(weeklyInsights.dataQuality, "structured");
  assert.match(weeklyInsights.advice, /蔬菜库存到期/);

  const feedbackRepository = new PostgresFeedbackRepository(pool);
  const feedbackId = await feedbackRepository.create(user.id, {
    category: "suggestion",
    content: "希望增加批量录入功能",
    context: { page: "inventory", recipeId: 12 },
  });
  const feedback = await pool.query(`
    SELECT user_id, category, content, context_json, status
    FROM user_feedback WHERE id = $1
  `, [feedbackId]);
  assert.deepEqual(feedback.rows[0], {
    user_id: user.id,
    category: "suggestion",
    content: "希望增加批量录入功能",
    context_json: { page: "inventory", recipeId: 12 },
    status: "received",
  });

  const postgresFood = await pool.query(`
    INSERT INTO ingredients_library
      (name, category, calories_100g, protein_100g, carbs_100g, fat_100g, barcode,
       original_name, normalized_name, search_keywords, micronutrients_json, source, quality_status)
    VALUES
      ('Postgres 番茄', '蔬菜', 18, 0.9, 3.9, 0.2, '6900000000097',
       'Postgres tomato', 'postgres番茄', 'postgresfood', '{"vitaminC":13.7}'::jsonb, 'official', 'trusted')
    RETURNING id
  `);
  const postgresFoodId = Number(postgresFood.rows[0]!.id);
  await pool.query(`
    INSERT INTO ingredient_aliases (ingredient_id, alias, normalized_alias)
    VALUES ($1, 'PG tomato', 'postgresfoodalias')
  `, [postgresFoodId]);
  const foodRepository = new PostgresFoodRepository(pool);
  assert.equal((await foodRepository.findByBarcode("6900000000097"))?.name, "Postgres 番茄");
  const postgresFoodResults = await foodRepository.searchTrusted("postgresfoodalias", 10);
  assert.equal(postgresFoodResults.length, 1);
  assert.deepEqual(postgresFoodResults[0]!.micronutrients_json, { vitaminC: 13.7 });
  await foodRepository.recordSearchGap("postgresgap", " Postgres missing food ");
  await foodRepository.recordSearchGap("postgresgap", "Postgres missing food updated");
  const postgresGap = await pool.query(`
    SELECT sample_query, hit_count FROM ingredient_search_gaps WHERE normalized_query = 'postgresgap'
  `);
  assert.deepEqual(postgresGap.rows[0], { sample_query: "Postgres missing food updated", hit_count: 2 });
  const customFoodId = await foodRepository.createCustom(user.id, {
    name: "Postgres 家庭豆浆",
    calories_100g: 31,
    protein_100g: 3,
    carbs_100g: 1.2,
    fat_100g: 1.6,
  });
  const customFood = await pool.query("SELECT user_id, name, status FROM user_custom_foods WHERE id = $1", [customFoodId]);
  assert.deepEqual(customFood.rows[0], { user_id: user.id, name: "Postgres 家庭豆浆", status: "pending" });

  const adminFoodRepository = new PostgresAdminFoodAssetsRepository(pool);
  const adminFoodService = new AdminFoodAssetsService(adminFoodRepository);
  const adminFoodContext = { adminUserId: user.id, ipAddress: "127.0.0.1", userAgent: "postgres-integration" };
  const legacyFoodPage = await adminFoodService.ingredients({ search: "Postgres 番茄", page: 1, pageSize: 10 });
  assert.equal(legacyFoodPage.items[0]?.micronutrients_json, '{"vitaminC":13.7}');
  const adminIngredient = (name: string, aliases: string[] = []) => ({
    name, category: "蔬菜", calories_100g: 20, protein_100g: 1, carbs_100g: 4, fat_100g: 0.2,
    source: "official", aliases, search_keywords: "postgres admin food", preparation_state: "raw",
    source_version: "postgres-admin-v1", data_license: "DietDigiDose-Original", edible_ratio: 1,
  });
  await assert.rejects(() => adminFoodService.createIngredient(adminIngredient("Postgres 回滚食材"), {
    ...adminFoodContext, adminUserId: 2_147_000_000,
  }));
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM ingredients_library WHERE name='Postgres 回滚食材'"))
    .rows[0]?.count), 0);
  const sourceAdminFood = await adminFoodService.createIngredient(adminIngredient("Postgres 管理番茄", ["PG 管理西红柿"]), adminFoodContext);
  const targetAdminFood = await adminFoodService.createIngredient(adminIngredient("Postgres 目标番茄"), adminFoodContext);
  await adminFoodService.updateIngredient(sourceAdminFood.id, adminIngredient("Postgres 管理红番茄", ["PG 红番茄"]), adminFoodContext);
  const addedAlias = await adminFoodService.addAlias(sourceAdminFood.id, { alias: "PG 红柿" }, adminFoodContext);
  assert.equal(addedAlias.aliases.includes("PG 红柿"), true);
  await adminFoodService.mergeIngredient(sourceAdminFood.id, { targetId: targetAdminFood.id }, adminFoodContext);
  const mergedTarget = (await pool.query("SELECT aliases_json FROM ingredients_library WHERE id=$1", [targetAdminFood.id])).rows[0];
  assert.equal(mergedTarget.aliases_json.includes("Postgres 管理红番茄"), true);
  const coverage = await adminFoodService.coverage();
  assert.equal(coverage.categories.some((item) => item.category === "蔬菜"), true);

  await adminFoodService.approveCustomFood(customFoodId, adminFoodContext);
  assert.equal((await pool.query("SELECT status FROM user_custom_foods WHERE id=$1", [customFoodId])).rows[0]?.status, "approved");
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM ingredients_library
    WHERE name='Postgres 家庭豆浆' AND source='ugc'`)).rows[0]?.count), 1);
  await assert.rejects(() => adminFoodService.approveCustomFood(customFoodId, adminFoodContext), /记录未找到/);
  const rejectedCustomFoodId = await foodRepository.createCustom(user.id, {
    name: "Postgres 驳回食品", calories_100g: 10, protein_100g: 0, carbs_100g: 1, fat_100g: 0,
  });
  await adminFoodService.rejectCustomFood(rejectedCustomFoodId, adminFoodContext);
  assert.equal((await pool.query("SELECT status FROM user_custom_foods WHERE id=$1", [rejectedCustomFoodId])).rows[0]?.status, "rejected");
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs WHERE action IN
    ('ingredient.create','ingredient.update','ingredient.alias_add','ingredient.merge','custom_food.approve','custom_food.reject')
    AND resource_id=ANY($1::text[])`, [[String(sourceAdminFood.id), String(targetAdminFood.id), String(customFoodId), String(rejectedCustomFoodId)]]))
    .rows[0]?.count), 7);
  await adminFoodService.removeIngredient(targetAdminFood.id, adminFoodContext);

  const adminConsoleRepository = new PostgresAdminConsoleRepository(pool);
  const adminConsoleService = new AdminConsoleService(adminConsoleRepository);
  await pool.query("INSERT INTO funnel_events (event_name,actor_hash) VALUES ('admin_console_test','actor-test')");
  await pool.query(`INSERT INTO inventory_scan_jobs (id,user_id,image_hash,status,result_json)
    VALUES ('admin-console-scan',$1,'hash-admin-console','completed','[{"foodName":"番茄"}]'::jsonb)`, [user.id]);
  await pool.query(`INSERT INTO ai_chat_messages (user_id,session_id,role,content,source,status,payload_json,response_time_ms)
    VALUES ($1,'admin-console-chat','user','管理员控制台问题','assistant','completed',NULL,NULL),
           ($1,'admin-console-chat','assistant','管理员控制台回答','assistant','completed','{"solutionCards":[{"title":"番茄汤"}]}'::jsonb,321)`, [user.id]);
  await pool.query(`INSERT INTO ai_usage_logs
    (user_id,endpoint,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,success,failure_reason,estimated_cost_usd)
    VALUES ($1,'admin-console','test-model',10,5,15,250,FALSE,'injected provider failure',0.001)`, [user.id]);
  const consoleStats = await adminConsoleService.stats();
  assert(Number(consoleStats.users) >= 1); assert(Number(consoleStats.ingredients) >= 1);
  assert.equal((await adminConsoleService.funnel({ days: 7 })).items.some((item) => item.eventName === "admin_console_test"), true);
  const consoleAudits = await adminConsoleService.auditLogs({ action: "ingredient.delete", page: 1, pageSize: 10 });
  assert.equal(consoleAudits.items.some((item) => item.resourceId === String(targetAdminFood.id)), true);
  const consoleScans = await adminConsoleService.scanJobs({ status: "completed", user: String(user.id) });
  assert.equal(consoleScans.items.find((item) => item.id === "admin-console-scan")?.itemCount, 1);
  assert.equal((await adminConsoleService.scanJob("admin-console-scan")).items.length, 1);
  const consoleConversations = await adminConsoleService.conversations({ query: String(user.id) });
  assert.equal(consoleConversations.items.some((item) => item.sessionId === "admin-console-chat"), true);
  const consoleConversation = await adminConsoleService.conversation(user.id, "admin-console-chat");
  assert.equal((consoleConversation.messages[1]?.payload as Record<string, unknown>).solutionCards instanceof Array, true);
  const consoleUsage = await adminConsoleService.usage({ range: "all", userId: user.id });
  assert(Number(consoleUsage.summary.totalTokens) >= 15);
  assert.equal(consoleUsage.failures.some((item) => item.endpoint === "admin-console"), true);
  assert.equal((await adminConsoleService.trends()).length, 7);
  assert((await adminConsoleService.recent()).recentUsers.length >= 1);
  assert.equal((await adminConsoleService.trash()).ingredients.some((item) => Number(item.id) === targetAdminFood.id), true);
  await assert.rejects(() => adminConsoleRepository.restore("ingredients", targetAdminFood.id, {
    adminUserId: 2_147_000_000, action: "ingredients.restore", resourceType: "ingredients",
    resourceId: targetAdminFood.id, summary: "回滚恢复测试",
  }));
  assert((await pool.query("SELECT deleted_at FROM ingredients_library WHERE id=$1", [targetAdminFood.id])).rows[0]?.deleted_at);
  await adminConsoleService.restore("ingredients", targetAdminFood.id, adminFoodContext);
  assert.equal((await pool.query("SELECT deleted_at FROM ingredients_library WHERE id=$1", [targetAdminFood.id])).rows[0]?.deleted_at, null);

  const householdMember = Number((await pool.query(`INSERT INTO users (username,email,password_hash)
    VALUES ('postgres-household-member','postgres-household-member@example.com','integration-hash') RETURNING id`)).rows[0]?.id);
  const householdsRepository = new PostgresHouseholdsRepository(pool);
  const householdsService = new HouseholdsService(householdsRepository, () => "PGHOUSE1");
  await assert.rejects(() => householdsRepository.create(2_147_000_000, "Postgres 回滚家庭", "PGROLL01"));
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM households WHERE invite_code='PGROLL01'"))
    .rows[0]?.count), 0);
  const postgresHousehold = await householdsService.create(user.id, "Postgres 协作家庭");
  const postgresHouseholdId = Number(postgresHousehold.id);
  assert.equal((await householdsService.join(householdMember, "pghouse1")).status, 201);
  const diningRecipeId = Number((await pool.query("INSERT INTO recipes(title,ingredients_json,status,serving_size) VALUES('共餐花生菜','[{\"name\":\"花生油\",\"amount\":\"10ml\"}]','approved',2) RETURNING id")).rows[0]?.id);
  const dietBeforeProduction = (await pool.query("SELECT count(*) AS n FROM diet_records")).rows[0];
  const producedHouseholdMeal = await verifyHouseholdProduction(householdsService,postgresHouseholdId,user.id,householdMember);
  assert.deepEqual((await pool.query("SELECT count(*) AS n FROM diet_records")).rows[0],dietBeforeProduction);
  const thirdDiner = Number((await pool.query("INSERT INTO users(username,email,password_hash) VALUES('third-diner','third-diner@example.com','hash') RETURNING id")).rows[0]?.id);
  await householdsService.join(thirdDiner,"PGHOUSE1");
  await verifyHouseholdEating(householdsService,postgresHouseholdId,String(producedHouseholdMeal.id),[user.id,householdMember,thirdDiner]);
  for (const dinerId of [user.id,householdMember,thirdDiner]) assert.deepEqual((await pool.query("SELECT amount,calories FROM diet_records WHERE user_id=$1 AND food_name='家庭蛋饭'",[dinerId])).rows,[{ amount: "1份",calories: null }]);
  await verifyHouseholdCorrections(householdsService,dietRepository,postgresHouseholdId,user.id,householdMember,"PGHOUSE1");
  await verifyHouseholdReservations(householdsService,dietRepository,postgresHouseholdId,user.id,householdMember,"PGHOUSE1");
  await verifyDiningPlanChanges(householdsService,new PostgresMealPlansRepository(pool),dietRepository,postgresHouseholdId,user.id,householdMember,diningRecipeId,"PGHOUSE1",async (sql,args = []) => {
    let index = 0; return (await pool.query(sql.replace(/\?/g,() => `$${++index}`),args)).rows;
  });
  await verifyHouseholdPlanProduction(householdsService,new PostgresMealPlansRepository(pool),postgresHouseholdId,user.id,householdMember,async (sql,args = []) => {
    let index = 0;
    return (await pool.query(sql.replace(/\?/g,() => `$${++index}`),args)).rows;
  });
  await verifyHouseholdPlanPreview(householdsService,postgresHouseholdId,user.id,householdMember,diningRecipeId,async (sql,args = []) => {
    let index = 0;
    return (await pool.query(sql.replace(/\?/g,() => `$${++index}`),args)).rows;
  });
  const staleDiningMembership = await verifyHouseholdDining(householdsService,postgresHouseholdId,user.id,householdMember,diningRecipeId);
  await householdsService.join(householdMember,"PGHOUSE1");
  assert.equal((await householdsService.diningPreferences(householdMember,postgresHouseholdId)).shared,false);
  await assert.rejects(() => householdsService.saveDiningPreferences(householdMember,postgresHouseholdId,{ ...staleDiningMembership,shared: true }),/已变化/);
  const firstHouseholdShopping = await householdsService.createShopping(user.id, postgresHouseholdId,
    "77777777-7777-4777-8777-777777777771", { name: "Postgres 家庭牛奶", amount: "2盒", category: "乳制品" });
  const secondHouseholdShopping = await householdsService.createShopping(householdMember, postgresHouseholdId,
    "77777777-7777-4777-8777-777777777772", { name: "Postgres 家庭番茄", amount: "3个", category: "蔬菜" });
  const purchasedFirst = await householdsService.updateShopping(householdMember, postgresHouseholdId,
    firstHouseholdShopping.item.id, { version: firstHouseholdShopping.item.version, checked: true });
  const purchasedSecond = await householdsService.updateShopping(user.id, postgresHouseholdId,
    secondHouseholdShopping.item.id, { version: secondHouseholdShopping.item.version, checked: true });
  const staleBatch = await householdsRepository.intake(user.id, postgresHouseholdId, "household-stale-batch", {
    idempotencyKey: "postgres-household-stale-intake-0001",
    items: [
      { id: purchasedFirst.id, version: purchasedFirst.version, quantity: "2盒", expirationDate: "2026-09-08", storageLocation: "冷藏" },
      { id: purchasedSecond.id, version: purchasedSecond.version - 1, quantity: "3个", expirationDate: "2026-09-06", storageLocation: "冷藏" },
    ],
  });
  assert.equal(staleBatch.kind, "version_conflict");
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM household_inventory_items WHERE household_id=$1",
    [postgresHouseholdId])).rows[0]?.count), 0);
  const intakeInput = { idempotencyKey: "postgres-household-concurrent-intake-0001", items: [
    { id: purchasedFirst.id, version: purchasedFirst.version, quantity: "2盒", expirationDate: "2026-09-08", storageLocation: "冷藏" },
    { id: purchasedSecond.id, version: purchasedSecond.version, quantity: "3个", expirationDate: "2026-09-06", storageLocation: "冷藏" },
  ] };
  const concurrentIntakes = await Promise.all([
    householdsRepository.intake(user.id, postgresHouseholdId, "household-intake-a", intakeInput),
    householdsRepository.intake(householdMember, postgresHouseholdId, "household-intake-b", intakeInput),
  ]);
  assert.deepEqual(concurrentIntakes.map((result) => result.kind).sort(), ["created", "repeated"]);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM household_inventory_items WHERE household_id=$1",
    [postgresHouseholdId])).rows[0]?.count), 2);
  const manualHouseholdInventory = await householdsService.createInventory(user.id, postgresHouseholdId, {
    food_name: "Postgres 家庭鸡蛋", expiration_date: "2026-09-09", quantity: "6个",
  });
  const inventoryRace = await Promise.allSettled([user.id,householdMember].map(actor => householdsService.updateInventory(actor, postgresHouseholdId,
    Number(manualHouseholdInventory.id), { quantity: "5个", is_available: true,version: Number(manualHouseholdInventory.version) })));
  assert.equal(inventoryRace.filter(result => result.status === "fulfilled").length,1);
  assert.equal(inventoryRace.filter(result => result.status === "rejected").length,1);
  const updatedHouseholdInventory = (inventoryRace.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Record<string,unknown>>).value;
  assert.equal(updatedHouseholdInventory.quantity, "5个");
  await assert.rejects(() => householdsService.updateInventory(householdMember, postgresHouseholdId,Number(manualHouseholdInventory.id),{ quantity: "99个",version: Number(manualHouseholdInventory.version) }),/其他成员更新/);
  await assert.rejects(() => householdsService.removeInventory(user.id, postgresHouseholdId, Number(manualHouseholdInventory.id),Number(manualHouseholdInventory.version)),/其他成员更新/);
  await householdsService.removeInventory(user.id, postgresHouseholdId, Number(manualHouseholdInventory.id),Number(updatedHouseholdInventory.version));
  assert((await householdsService.history(user.id, postgresHouseholdId)).length >= 7);
  await assert.rejects(() => householdsService.transferOwner(user.id, postgresHouseholdId,
    { newOwnerUserId: householdMember, version: 999 }), /家庭空间已更新/);
  const currentHousehold = (await householdsService.mine(user.id)).find((item) => Number(item.id) === postgresHouseholdId)!;
  await householdsService.transferOwner(user.id, postgresHouseholdId,
    { newOwnerUserId: householdMember, version: Number(currentHousehold.version) });
  await householdsService.leave(user.id, postgresHouseholdId);
  await householdsService.leave(householdMember, postgresHouseholdId);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM households WHERE id=$1", [postgresHouseholdId]))
    .rows[0]?.count), 0);

  const cookingQueueRepository = new PostgresCookingQueueRepository(pool);
  await pool.query("DELETE FROM cooking_queue_items WHERE user_id = $1", [user.id]);
  const queueRecipes = await pool.query(`SELECT id, title, image_url, cook_time, calories, difficulty, ingredients_json
    FROM recipes WHERE deleted_at IS NULL AND status = 'approved' ORDER BY id LIMIT 2`);
  assert.equal(queueRecipes.rows.length, 2);
  const queueRecipe = queueRecipes.rows[0]!;
  const aiWriteRepository = new PostgresAIWriteConfirmationsRepository(pool);
  const aiWriteService = new AIWriteConfirmationsService(aiWriteRepository);
  const inventoryPreview = await aiWriteService.createPreview({ userId: user.id, action: "add_inventory_item",
    payload: { name: "PostgreSQL AI 确认番茄", quantity: "3个", location: "冷藏", expireDays: 4 },
    conversationId: "postgres-ai-write", sourceMessageId: "message-1" });
  const concurrentAIWrites = await Promise.all([
    aiWriteService.commit({ userId: user.id, confirmationId: inventoryPreview.confirmationId,
      idempotencyKey: "postgres-ai-write-concurrent-0001" }),
    aiWriteService.commit({ userId: user.id, confirmationId: inventoryPreview.confirmationId,
      idempotencyKey: "postgres-ai-write-concurrent-0001" }),
  ]);
  assert.equal(concurrentAIWrites[0]!.id, concurrentAIWrites[1]!.id);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::int AS count FROM inventory_items
    WHERE user_id=$1 AND food_name='PostgreSQL AI 确认番茄'`, [user.id])).rows[0]?.count), 1);
  await assert.rejects(() => aiWriteService.commit({ userId: user.id + 1, confirmationId: inventoryPreview.confirmationId,
    idempotencyKey: "postgres-ai-write-foreign-0001" }), /不存在或无权/);
  const dietPreview = await aiWriteService.createPreview({ userId: user.id, action: "record_diet_meal",
    payload: { mealType: "午餐", foodName: "PostgreSQL AI 确认餐", amount: "1份", calories: 260 } });
  const kitchenwarePreview = await aiWriteService.createPreview({ userId: user.id, action: "add_kitchenware_item",
    payload: { name: "PostgreSQL AI 确认炒锅", category: "烹饪锅具", status: "良好" } });
  await aiWriteService.commit({ userId: user.id, confirmationId: dietPreview.confirmationId,
    idempotencyKey: "postgres-ai-write-diet-0001" });
  await aiWriteService.commit({ userId: user.id, confirmationId: kitchenwarePreview.confirmationId,
    idempotencyKey: "postgres-ai-write-kitchenware-0001" });
  const concurrentHealthPreviews = await Promise.all([
    aiWriteService.createPreview({ userId: householdMember, action: "record_health_log", payload: { weightKg: 60.5 } }),
    aiWriteService.createPreview({ userId: householdMember, action: "record_health_log", payload: { waterMl: 500 } }),
  ]);
  await Promise.all(concurrentHealthPreviews.map((preview, index) => aiWriteService.commit({ userId: householdMember,
    confirmationId: preview.confirmationId, idempotencyKey: `postgres-ai-write-health-concurrent-000${index + 2}` })));
  const concurrentHealth = (await pool.query(`SELECT COUNT(*)::int AS count,MAX(weight) AS weight,MAX(water_ml) AS water_ml
    FROM health_logs WHERE user_id=$1 AND recorded_date=$2`, [householdMember, currentDateKey()])).rows[0];
  assert.deepEqual({ count: Number(concurrentHealth.count), weight: Number(concurrentHealth.weight), waterMl: Number(concurrentHealth.water_ml) },
    { count: 1, weight: 60.5, waterMl: 500 });
  assert.equal(Number((await pool.query("SELECT calories FROM diet_records WHERE user_id=$1 AND food_name=$2",
    [user.id, "PostgreSQL AI 确认餐"])).rows[0]?.calories), 260);
  assert.equal((await pool.query("SELECT status FROM kitchenware_items WHERE user_id=$1 AND name=$2",
    [user.id, "PostgreSQL AI 确认炒锅"])).rows[0]?.status, "良好");
  const expiredPreview = await aiWriteService.createPreview({ userId: user.id, action: "record_health_log", payload: { waterMl: 100 } });
  await pool.query("UPDATE ai_write_confirmations SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1",
    [expiredPreview.confirmationId]);
  await assert.rejects(() => aiWriteService.commit({ userId: user.id, confirmationId: expiredPreview.confirmationId,
    idempotencyKey: "postgres-ai-write-expired-0001" }), /确认已过期/);
  const aiWriteNativeTypes = (await pool.query(`SELECT pg_typeof(payload_json)::text AS payload_type,
    pg_typeof(committed_result_json)::text AS result_type FROM ai_write_confirmations WHERE id=$1`,
  [inventoryPreview.confirmationId])).rows[0];
  assert.deepEqual(aiWriteNativeTypes, { payload_type: "jsonb", result_type: "jsonb" });
  assert.equal(Number((await pool.query("SELECT COUNT(*)::int AS count FROM ai_write_audit_logs WHERE confirmation_id=$1",
    [inventoryPreview.confirmationId])).rows[0]?.count), 2);
  const aiConversationsRepository = new PostgresAIConversationsRepository(pool);
  const aiConversationsService = new AIConversationsService(aiConversationsRepository);
  const conversationSessionId = `postgres-ai-conversation-${user.id}`;
  const conversationRunId = `postgres-ai-conversation-run-${user.id}`;
  await pool.query("DELETE FROM agent_runs WHERE id=$1", [conversationRunId]);
  await pool.query("DELETE FROM ai_chat_session_deletions WHERE user_id=$1 AND session_id=$2", [user.id, conversationSessionId]);
  await pool.query("DELETE FROM ai_chat_messages WHERE user_id=$1 AND session_id=$2", [user.id, conversationSessionId]);
  const firstConversationAt = Date.now();
  assert.equal(await aiConversationsService.recordTurn({ userId: user.id, sessionId: conversationSessionId,
    source: "assistant", userContent: "PostgreSQL 会话问题", assistantContent: "PostgreSQL 会话回答",
    systemContents: ["PostgreSQL 系统上下文"], payload: { trace: { provider: "postgres" } }, responseTimeMs: 25,
    requestedAt: firstConversationAt, respondedAt: firstConversationAt + 25 }), true);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$3,'text','assistant','completed','{}'::jsonb,$1)`, [conversationRunId, user.id, conversationSessionId]);
  await pool.query(`INSERT INTO agent_run_media(id,run_id,user_id,kind,mime_type,data_base64)
    VALUES($1,$2,$3,'image','image/png','cG5n')`, [`${conversationRunId}-media`, conversationRunId, user.id]);
  const requestedBeforeDelete = Date.now() - 1_000;
  await Promise.all([
    aiConversationsService.recordTurn({ userId: user.id, sessionId: conversationSessionId, source: "assistant",
      userContent: "删除前的问题", assistantContent: "迟到回答", responseTimeMs: 1_100,
      requestedAt: requestedBeforeDelete, respondedAt: Date.now() + 100 }),
    aiConversationsService.deleteConversation(user.id, conversationSessionId),
  ]);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::int AS count FROM ai_chat_messages WHERE user_id=$1 AND session_id=$2",
    [user.id, conversationSessionId])).rows[0]?.count), 0);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::int AS count FROM agent_run_media WHERE run_id=$1",
    [conversationRunId])).rows[0]?.count), 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const requestedAfterDelete = Date.now();
  assert.equal(await aiConversationsService.recordTurn({ userId: user.id, sessionId: conversationSessionId,
    source: "assistant", userContent: "删除后的新问题", assistantContent: "新回答", payload: { safe: true },
    responseTimeMs: 20, requestedAt: requestedAfterDelete, respondedAt: requestedAfterDelete + 20 }), true);
  const conversationNativeType = (await pool.query(`SELECT pg_typeof(payload_json)::text AS payload_type
    FROM ai_chat_messages WHERE user_id=$1 AND session_id=$2 AND role='assistant'`, [user.id, conversationSessionId])).rows[0];
  assert.deepEqual(conversationNativeType, { payload_type: "jsonb" });
  const legacyScanId = `postgres-ai-conversation-scan-${user.id}`;
  await pool.query(`INSERT INTO inventory_scan_jobs(id,user_id,image_hash,status,result_json)
    VALUES($1,$2,$1,'completed','[{"foodName":"PostgreSQL 番茄"}]'::jsonb)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,status=excluded.status,result_json=excluded.result_json`,
  [legacyScanId, user.id]);
  assert.deepEqual((await aiConversationsService.legacyInventoryScanJob(legacyScanId, user.id))?.result,
    [{ foodName: "PostgreSQL 番茄" }]);
  assert.equal(await aiConversationsService.legacyInventoryScanJob(legacyScanId, householdMember), null);
  const agentRunsService = new AgentRunsService(new PostgresAgentRunsRepository(pool));
  const postgresAgentRunInput = {
    modality: "image", source: "assistant", sessionId: " postgres-agent-runs ", prompt: "识别 PostgreSQL 番茄",
    image: "data:image/png;base64,cG9zdGdyZXMtc2VjcmV0", mimeType: "image/png", idempotencyKey: "postgres-agent-runs-key",
  } as const;
  const concurrentAgentRuns = await Promise.all([
    agentRunsService.createRun(user.id, postgresAgentRunInput),
    agentRunsService.createRun(user.id, postgresAgentRunInput),
  ]);
  assert.deepEqual(concurrentAgentRuns[0], concurrentAgentRuns[1]);
  const agentRun = concurrentAgentRuns[0]!;
  assert.equal(agentRun.sessionId, "postgres-agent-runs");
  const storedAgentRun = await agentRunsService.run(agentRun.id, user.id);
  assert(storedAgentRun);
  assert.equal(storedAgentRun.input_json.includes("cG9zdGdyZXMtc2VjcmV0"), false);
  assert.equal((await agentRunsService.media(agentRun.id, user.id))?.data_base64,
    "data:image/png;base64,cG9zdGdyZXMtc2VjcmV0");
  assert.equal(await agentRunsService.run(agentRun.id, householdMember), undefined);
  assert.equal((await agentRunsService.reusableRun(user.id, "postgres-agent-runs-key"))?.id, agentRun.id);
  const durablePhotoInput = { modality: "inventory_scan" as const, image: "cGhvdG8=", idempotencyKey: "inventory-photo:pg-test" };
  const durablePhoto = await agentRunsService.createRun(user.id, durablePhotoInput);
  await pool.query("UPDATE agent_runs SET status='completed',created_at=CURRENT_TIMESTAMP-INTERVAL '2 days' WHERE id=$1", [durablePhoto.id]);
  const repeatedPhoto = await Promise.all([agentRunsService.createRun(user.id,durablePhotoInput),agentRunsService.createRun(user.id,durablePhotoInput)]);
  assert(repeatedPhoto.every(run => run.id === durablePhoto.id));
  assert.notEqual((await agentRunsService.createRun(householdMember,durablePhotoInput)).id, durablePhoto.id);

  const checkpointRun = await agentRunsService.createRun(user.id, {
    modality: "text", prompt: "验证 PostgreSQL checkpoint", idempotencyKey: "postgres-checkpoint-key",
  });
  const postgresCheckpointer = await createPostgresAgentCheckpointer(pool);
  const checkpointConfig = await postgresCheckpointer.put(
    { configurable: { thread_id: checkpointRun.id, checkpoint_ns: "" } },
    {
      v: 1,
      id: "00000000-0000-6000-8000-000000000001",
      ts: new Date().toISOString(),
      channel_values: { goal: "验证 PostgreSQL checkpoint" },
      channel_versions: { goal: "1" },
      versions_seen: {},
    },
    { source: "input", step: 0, parents: {} },
    { goal: "1" },
  );
  await postgresCheckpointer.putWrites(checkpointConfig, [["checkpoint_test", { ok: true }]], "checkpoint-task");
  const checkpointTuple = await postgresCheckpointer.getTuple(checkpointConfig);
  assert.equal(checkpointTuple?.checkpoint.channel_values.goal, "验证 PostgreSQL checkpoint");
  assert.deepEqual(checkpointTuple?.pendingWrites, [["checkpoint-task", "checkpoint_test", { ok: true }]]);
  const checkpointStorage = (await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM checkpoints WHERE thread_id=$1) AS checkpoints,
    (SELECT COUNT(*)::integer FROM checkpoint_blobs WHERE thread_id=$1) AS blobs,
    (SELECT COUNT(*)::integer FROM checkpoint_writes WHERE thread_id=$1) AS writes,
    (SELECT MAX(v)::integer FROM checkpoint_migrations) AS version`, [checkpointRun.id])).rows[0];
  assert.deepEqual(checkpointStorage, { checkpoints: 1, blobs: 1, writes: 1, version: 4 });
  await pool.query("DELETE FROM agent_runs WHERE id=$1", [checkpointRun.id]);
  assert.equal(await postgresCheckpointer.getTuple(checkpointConfig), undefined);
  const checkpointRowsAfterRunDeletion = (await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM checkpoints WHERE thread_id=$1) AS checkpoints,
    (SELECT COUNT(*)::integer FROM checkpoint_blobs WHERE thread_id=$1) AS blobs,
    (SELECT COUNT(*)::integer FROM checkpoint_writes WHERE thread_id=$1) AS writes`, [checkpointRun.id])).rows[0];
  assert.deepEqual(checkpointRowsAfterRunDeletion, { checkpoints: 0, blobs: 0, writes: 0 });
  const concurrentEventSequences = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    agentRunsService.appendEvent(agentRun.id, user.id, "VisionAgent", "concurrent_event", `并发事件 ${index + 1}`, { index })));
  assert.deepEqual([...concurrentEventSequences].sort((left, right) => left - right),
    Array.from({ length: 12 }, (_, index) => index + 2));
  assert.deepEqual((await agentRunsService.events(agentRun.id, user.id)).map((event) => event.sequence),
    Array.from({ length: 13 }, (_, index) => index + 1));
  await agentRunsService.setStatus(agentRun.id, "running");
  const runProposals = [
    { actionType: "record_diet_meal" as const, riskLevel: "high" as const,
      summary: "记录 PostgreSQL 晚餐", payload: { foodName: "番茄" } },
    { actionType: "record_health_log" as const, riskLevel: "high" as const,
      summary: "记录 PostgreSQL 饮水", payload: { waterMl: 300 } },
  ];
  const concurrentSavedActions = await Promise.all([
    agentRunsService.saveActions(agentRun.id, user.id, runProposals),
    agentRunsService.saveActions(agentRun.id, user.id, runProposals),
  ]);
  assert.deepEqual(concurrentSavedActions[0], concurrentSavedActions[1]);
  assert.equal((await agentRunsService.actions(agentRun.id, user.id)).length, 2);
  await assert.rejects(() => agentRunsService.reviseActions(agentRun.id, user.id, [
    { ...runProposals[0], id: concurrentSavedActions[0]![0]!.id, payload: { foodName: "鸡蛋" } },
    { ...runProposals[1], id: "missing-agent-action", payload: { waterMl: 999 } },
  ]), /已变化/);
  assert.deepEqual((await agentRunsService.actions(agentRun.id, user.id))[0]?.payload, { foodName: "番茄" });
  const approvedActionId = concurrentSavedActions[0]![0]!.id;
  await agentRunsService.recordActionDecision([approvedActionId], user.id, "approve");
  await agentRunsService.updateActionStatus(approvedActionId, "executed", { result: { dietRecordId: 123 } });
  assert.deepEqual((await agentRunsService.actions(agentRun.id, user.id))[0]?.result, { dietRecordId: 123 });
  await agentRunsService.setStatus(agentRun.id, "completed", { result: { reply: "PostgreSQL Agent Run 完成" }, pendingApproval: null });
  const completedAgentRun = await agentRunsService.run(agentRun.id, user.id);
  assert.equal(completedAgentRun?.status, "completed");
  assert.equal(completedAgentRun?.result_json, '{"reply":"PostgreSQL Agent Run 完成"}');
  assert.equal(await agentRunsService.setStatus(agentRun.id, "cancelled"), false);
  const agentRunNativeTypes = (await pool.query(`SELECT pg_typeof(input_json)::text AS input_type,
    pg_typeof(result_json)::text AS result_type FROM agent_runs WHERE id=$1`, [agentRun.id])).rows[0];
  assert.deepEqual(agentRunNativeTypes, { input_type: "jsonb", result_type: "jsonb" });
  const adminAgentRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const adminAgentActionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await pool.query("DELETE FROM agent_runs WHERE id=$1", [adminAgentRunId]);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,result_json,
    checkpoint_thread_id,started_at,completed_at) VALUES($1,$2,'postgres-admin-agent','image','vision-food','completed',
    '{"prompt":"识别 PostgreSQL 沙拉","mediaRef":"must-not-leak"}'::jsonb,
    '{"reply":"PostgreSQL 蔬菜沙拉","artifacts":[{"type":"vision","data":{"confidence":0.93}}]}'::jsonb,
    $1,CURRENT_TIMESTAMP-INTERVAL '3 seconds',CURRENT_TIMESTAMP)`, [adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO agent_run_media(id,run_id,user_id,kind,mime_type,data_base64)
    VALUES('postgres-admin-agent-media',$1,$2,'image','image/png','raw-media-must-not-leak')`, [adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO agent_run_events(run_id,user_id,sequence,agent_name,event_type,summary,payload_json) VALUES
    ($1,$2,1,'Supervisor','routing_started','开始分派','{"specialists":["VisionAgent"]}'::jsonb),
    ($1,$2,2,'VisionAgent','agent_completed','视觉识别完成','{"confidence":0.93}'::jsonb),
    ($1,$2,3,'OperationsAgent','agent_completed','动作完成',NULL),
    ($1,$2,4,'Supervisor','run_completed','运行完成',NULL)`, [adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'add_inventory_item','high','awaiting_approval','{"foodName":"生菜"}'::jsonb,$1)`,
  [adminAgentActionId, adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO ai_usage_logs(user_id,endpoint,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,
    success,estimated_cost_usd,run_id,agent_name,phase) VALUES
    ($1,'agent:Supervisor','postgres-supervisor',120,30,150,800,TRUE,0.0012,$2,'Supervisor','routing'),
    ($1,'agent:VisionAgent','postgres-vision',200,50,250,1200,TRUE,0.0025,$2,'VisionAgent','recognition')`,
  [user.id, adminAgentRunId]);
  await postgresCheckpointer.put(
    { configurable: { thread_id: adminAgentRunId, checkpoint_ns: "" } },
    {
      v: 1, id: "00000000-0000-6000-8000-000000000002", ts: new Date().toISOString(),
      channel_values: { goal: "识别 PostgreSQL 沙拉" }, channel_versions: { goal: "1" }, versions_seen: {},
    },
    { source: "loop", step: 1, parents: {} }, { goal: "1" },
  );
  const adminAgentRunsService = new AdminAgentRunsService(new PostgresAdminAgentRunsRepository(pool));
  const adminAgentList = await adminAgentRunsService.list({ query: adminAgentRunId, modality: "image", agent: "VisionAgent", range: "all" });
  assert.equal(adminAgentList.total, 1);
  assert.equal(adminAgentList.items[0]?.specialists, "VisionAgent,OperationsAgent");
  assert.equal(adminAgentList.items[0]?.hasMedia, 1);
  assert.equal(adminAgentList.items[0]?.totalTokens, 400);
  assert.equal(adminAgentList.usageSummary.estimatedCostUsd, 0.0037);
  const adminAgentDetail = await adminAgentRunsService.detail(adminAgentRunId);
  assert.equal(adminAgentDetail.run.input.prompt, "识别 PostgreSQL 沙拉");
  assert.equal(adminAgentDetail.run.input.mediaRef, undefined);
  assert.equal(adminAgentDetail.run.checkpointCount, 1);
  assert.equal((adminAgentDetail.events[2]?.payload as { actions: Array<{ payload: { foodName: string } }> })
    .actions[0]?.payload.foodName, "生菜");
  assert.equal((adminAgentDetail.events[3]?.payload as { reply: string }).reply, "PostgreSQL 蔬菜沙拉");
  assert.equal(adminAgentDetail.usage.summary.totalTokens, 400);
  assert.equal(JSON.stringify(adminAgentDetail).includes("raw-media-must-not-leak"), false);
  const schedulingService = new AgentSchedulingService(new PostgresAgentSchedulingRepository(pool));
  const schedulingRunIds = [0, 1, 2, 3].map((index) => `postgres-agent-scheduling-${user.id}-${index}`);
  await pool.query("DELETE FROM agent_runs WHERE id=ANY($1::text[])", [schedulingRunIds]);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id,created_at)
    SELECT id,$1,id,'text','assistant',status,'{}'::jsonb,id,created_at FROM UNNEST(
      $2::text[],$3::text[],$4::timestamptz[]) AS seed(id,status,created_at)`, [user.id, schedulingRunIds,
    ["running", "queued", "queued", "queued"],
    ["2026-09-01T00:00:00Z", "2026-09-01T00:00:01Z", "2026-09-01T00:00:02Z", "2026-09-01T00:00:03Z"]]);
  const concurrentSchedulingClaims = await Promise.all([
    schedulingService.claimQueuedRuns(user.id, 2), schedulingService.claimQueuedRuns(user.id, 2),
  ]);
  assert.deepEqual(concurrentSchedulingClaims.flat(), [schedulingRunIds[1]]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM agent_runs
    WHERE id=ANY($1::text[]) AND status='running'`, [schedulingRunIds])).rows[0]?.count), 2);
  const schedulingActionId = `postgres-agent-scheduling-action-${user.id}`;
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'record_diet_meal','high','awaiting_approval','{}'::jsonb,$1)`,
  [schedulingActionId, schedulingRunIds[1], user.id]);
  assert.equal(await schedulingService.expireAwaitingApproval(schedulingRunIds[1]!, user.id), 1);
  assert.equal((await pool.query("SELECT status FROM agent_actions WHERE id=$1", [schedulingActionId])).rows[0]?.status, "expired");
  assert.equal(await schedulingService.resetInterruptedRuns() >= 2, true);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM agent_runs
    WHERE id=ANY($1::text[]) AND status='queued'`, [schedulingRunIds])).rows[0]?.count), 4);
  const operationsService = new AgentOperationsService(new PostgresAgentOperationsRepository(pool));
  const operationsRunId = `postgres-agent-operations-${user.id}`;
  const operationsActionId = `postgres-agent-operations-action-${user.id}`;
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [operationsRunId, user.id]);
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'add_shopping_items','low','proposed',$4,$1)`,
  [operationsActionId, operationsRunId, user.id, { items: [{ name: "PostgreSQL Agent 番茄", amount: "2个" }] }]);
  const operationsProposal = { id: operationsActionId, actionType: "add_shopping_items" as const, riskLevel: "low" as const,
    summary: "加入 PostgreSQL 采购清单", payload: { items: [{ name: "PostgreSQL Agent 番茄", amount: "2个" }] } };
  const concurrentOperations = await Promise.all([
    operationsService.executeActions(user.id, operationsRunId, [operationsProposal]),
    operationsService.executeActions(user.id, operationsRunId, [operationsProposal]),
  ]);
  assert.deepEqual(concurrentOperations[0], concurrentOperations[1]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM shopping_list_items
    WHERE user_id=$1 AND source_run_id=$2`, [user.id, operationsRunId])).rows[0]?.count), 1);
  assert.deepEqual(await operationsService.undoActions(user.id, operationsRunId), { undone: 1 });
  assert.equal((await pool.query(`SELECT status FROM agent_actions WHERE id=$1`, [operationsActionId])).rows[0]?.status, "undone");
  assert.equal((await pool.query(`SELECT deleted_at IS NOT NULL AS deleted,version FROM shopping_list_items
    WHERE source_run_id=$1`, [operationsRunId])).rows[0]?.deleted, true);
  assert.deepEqual(await operationsService.undoActions(user.id, operationsRunId), { undone: 0 });

  const groupedUndoRun = `postgres-grouped-undo-${user.id}`;
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [groupedUndoRun, user.id]);
  const groupedExecute = async (suffix: string, actionType: ExecutableAgentAction["actionType"], payload: Record<string, unknown>) => {
    const id = `${groupedUndoRun}-${suffix}`;
    await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
      VALUES($1,$2,$3,$4,'high','proposed',$5,$1)`, [id, groupedUndoRun, user.id, actionType, payload]);
    return operationsService.executeActions(user.id, groupedUndoRun, [{ id, actionType, payload, riskLevel: "high", summary: "分组撤销" }]);
  };
  const groupedAdded = await groupedExecute("z", "add_inventory_item", { name: "PG 连续修正鸡蛋", quantity: "10个", expirationDate: "2026-09-20" });
  const groupedItemId = Number((groupedAdded[0].result as Record<string, unknown>).inventoryItemId);
  await groupedExecute("b", "update_inventory_item", { itemId: groupedItemId, version: 1, quantity: "8个" });
  await groupedExecute("a", "update_inventory_item", { itemId: groupedItemId, version: 2, quantity: "6个" });
  assert.deepEqual(await operationsService.undoActions(user.id, groupedUndoRun), { undone: 3 });
  assert.deepEqual(await operationsService.undoActions(user.id, groupedUndoRun), { undone: 0 });
  const groupedRestored = (await pool.query("SELECT quantity_value,version,deleted_at IS NOT NULL AS deleted FROM inventory_items WHERE id=$1", [groupedItemId])).rows[0];
  assert.equal(Number(groupedRestored.quantity_value), 10);
  assert.equal(groupedRestored.version, 6);
  assert.equal(groupedRestored.deleted, true);

  const failedOperationsRunId = `postgres-agent-operations-failed-${user.id}`;
  const failedOperationsActionIds = ["first", "second"].map((suffix) => `${failedOperationsRunId}-${suffix}`);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [failedOperationsRunId, user.id]);
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$3,$4,'add_shopping_items','low','proposed','{}'::jsonb,$1),
          ($2,$3,$4,'update_shopping_item','low','proposed','{}'::jsonb,$2)`,
  [failedOperationsActionIds[0], failedOperationsActionIds[1], failedOperationsRunId, user.id]);
  await assert.rejects(() => operationsService.executeActions(user.id, failedOperationsRunId, [
    { id: failedOperationsActionIds[0], actionType: "add_shopping_items", riskLevel: "low", summary: "应整体回滚",
      payload: { items: [{ name: "PostgreSQL 应回滚" }] } },
    { id: failedOperationsActionIds[1], actionType: "update_shopping_item", riskLevel: "low", summary: "触发回滚",
      payload: { itemId: "missing" } },
  ]), /不存在或无权修改/);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM shopping_list_items
    WHERE user_id=$1 AND name='PostgreSQL 应回滚'`, [user.id])).rows[0]?.count), 0);
  assert.deepEqual((await pool.query(`SELECT status FROM agent_actions WHERE id=ANY($1::text[]) ORDER BY id`,
    [failedOperationsActionIds])).rows.map((row) => row.status), ["failed", "failed"]);

  const operationTypesRunId = `postgres-agent-operation-types-${user.id}`;
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [operationTypesRunId, user.id]);
  const insertOperationProposals = async (proposals: ExecutableAgentAction[]) => {
    for (const proposal of proposals) {
      await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
        VALUES($1,$2,$3,$4,$5,'proposed',$6,$1)`,
      [proposal.id, operationTypesRunId, user.id, proposal.actionType, proposal.riskLevel, proposal.payload]);
    }
  };
  const createOperationProposals: ExecutableAgentAction[] = [
    { id: `${operationTypesRunId}-plan`, actionType: "create_meal_plan", riskLevel: "low", summary: "创建餐单",
      payload: { title: "PostgreSQL Agent 餐单", startDate: "2026-09-01", endDate: "2026-09-02", constraints: { salt: "low" },
        items: [{ date: "2026-09-01", mealType: "晚餐", title: "番茄蛋", ingredients: ["番茄"], steps: ["翻炒"], calories: 320.4 }] } },
    { id: `${operationTypesRunId}-shopping`, actionType: "add_shopping_items", riskLevel: "low", summary: "创建采购项",
      payload: { items: [{ name: "PostgreSQL Agent 洋葱", amount: "1个", category: "蔬菜" }] } },
    { id: `${operationTypesRunId}-diet`, actionType: "record_diet_meal", riskLevel: "high", summary: "记录饮食",
      payload: { foodName: "PostgreSQL Agent 午餐", calories: 430.6, recordedAt: "2026-09-01" } },
    { id: `${operationTypesRunId}-inventory`, actionType: "add_inventory_item", riskLevel: "high", summary: "增加库存",
      payload: { name: "PostgreSQL Agent 土豆", quantity: "2个", expireDays: 5 } },
    { id: `${operationTypesRunId}-kitchenware`, actionType: "add_kitchenware_item", riskLevel: "high", summary: "增加厨具",
      payload: { name: "PostgreSQL Agent 炒锅", category: "锅具" } },
    { id: `${operationTypesRunId}-recipe`, actionType: "submit_recipe", riskLevel: "high", summary: "提交菜谱",
      payload: { title: "PostgreSQL Agent 菜谱", cookTime: 12.7, calories: 280.8, tags: ["测试"], steps: ["烹饪"], ingredients: ["土豆"] } },
  ];
  await insertOperationProposals(createOperationProposals);
  assert.equal((await operationsService.executeActions(user.id, operationTypesRunId, createOperationProposals)).length, 6);
  const createdPlan = (await pool.query("SELECT id FROM meal_plans WHERE created_by_run_id=$1", [operationTypesRunId])).rows[0];
  const createdShopping = (await pool.query("SELECT id FROM shopping_list_items WHERE source_run_id=$1", [operationTypesRunId])).rows[0];
  const createdInventory = (await pool.query("SELECT id FROM inventory_items WHERE user_id=$1 AND food_name='PostgreSQL Agent 土豆'", [user.id])).rows[0];
  assert(createdPlan?.id && createdShopping?.id && createdInventory?.id);
  const mutateOperationProposals: ExecutableAgentAction[] = [
    { id: `${operationTypesRunId}-plan-update`, actionType: "update_meal_plan", riskLevel: "low", summary: "更新餐单",
      payload: { planId: createdPlan.id, title: "PostgreSQL Agent 新餐单" } },
    { id: `${operationTypesRunId}-shopping-update`, actionType: "update_shopping_item", riskLevel: "low", summary: "更新采购项",
      payload: { itemId: createdShopping.id, amount: "3个", checked: true } },
    { id: `${operationTypesRunId}-inventory-update`, actionType: "update_inventory_item", riskLevel: "high", summary: "更新库存",
      payload: { itemId: createdInventory.id, version: 1, name: "PostgreSQL Agent 新土豆" } },
    { id: `${operationTypesRunId}-inventory-consume`, actionType: "consume_inventory_items", riskLevel: "high", summary: "消耗库存",
      payload: { items: [{ itemId: createdInventory.id, version: 2, mode: "all" }] } },
    { id: `${operationTypesRunId}-plan-delete`, actionType: "delete_meal_plan", riskLevel: "high", summary: "删除餐单",
      payload: { planId: createdPlan.id } },
    { id: `${operationTypesRunId}-shopping-delete`, actionType: "delete_shopping_item", riskLevel: "high", summary: "删除采购项",
      payload: { itemId: createdShopping.id } },
  ];
  await insertOperationProposals(mutateOperationProposals);
  assert.equal((await operationsService.executeActions(user.id, operationTypesRunId, mutateOperationProposals)).length, 6);
  assert.deepEqual((await pool.query(`SELECT deleted_at IS NOT NULL AS deleted,title FROM meal_plans WHERE id=$1`, [createdPlan.id])).rows[0],
    { deleted: true, title: "PostgreSQL Agent 新餐单" });
  assert.deepEqual((await pool.query(`SELECT deleted_at IS NOT NULL AS deleted,amount,checked FROM shopping_list_items WHERE id=$1`, [createdShopping.id])).rows[0],
    { deleted: true, amount: "3个", checked: true });
  assert.deepEqual((await pool.query(`SELECT food_name,is_available FROM inventory_items WHERE id=$1`, [createdInventory.id])).rows[0],
    { food_name: "PostgreSQL Agent 新土豆", is_available: false });
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM agent_actions
    WHERE run_id=$1 AND status='executed'`, [operationTypesRunId])).rows[0]?.count), 12);
  let inventoryActionSequence = 0;
  const inventoryAction = (actionType: ExecutableAgentAction["actionType"], payload: Record<string, unknown>): ExecutableAgentAction => ({
    id: `${operationTypesRunId}-quantity-${++inventoryActionSequence}`, actionType, payload, riskLevel: "high", summary: "库存数量回归",
  });
  const runInventoryActions = async (actions: ExecutableAgentAction[]) => {
    await insertOperationProposals(actions);
    return operationsService.executeActions(user.id, operationTypesRunId, actions);
  };
  const eggCreated = await runInventoryActions([inventoryAction("add_inventory_item", { name: "数量回归鸡蛋", quantity: "十枚" })]);
  const eggId = (eggCreated[0].result as { inventoryItemId: number }).inventoryItemId;
  const eggState = async () => (await pool.query("SELECT quantity,quantity_value,quantity_unit,is_available,version FROM inventory_items WHERE id=$1", [eggId])).rows[0];
  const eatTwo = inventoryAction("consume_inventory_items", { items: [{ itemId: eggId, version: 1, mode: "amount", amountValue: 2, unit: "piece" }] });
  const eaten = await runInventoryActions([eatTwo]);
  assert.deepEqual(await operationsService.executeActions(user.id, operationTypesRunId, [eatTwo]), eaten);
  assert.equal((await eggState()).quantity, "8个");
  assert.equal(Number((await eggState()).quantity_value), 8);
  assert.equal((await eggState()).is_available, true);
  const discardTwo = inventoryAction("consume_inventory_items", { reason: "discarded", items: [{ itemId: eggId, version: 2, mode: "amount", amountValue: 2, unit: "piece" }] });
  await runInventoryActions([discardTwo]);
  const discardHistory = (await pool.query("SELECT source,metadata_json FROM inventory_change_logs WHERE inventory_item_id=$1 AND action='consume_partial' ORDER BY id", [eggId])).rows;
  assert.equal(discardHistory.length, 2);
  assert.equal(discardHistory[1].source, "ai");
  assert.equal(discardHistory[1].metadata_json.reason, "discarded");
  for (const consumption of [
    { itemId: eggId, version: 2, mode: "amount", amountValue: 1, unit: "piece" },
    { itemId: eggId, version: 3, mode: "amount", amountValue: 1, unit: "g" },
    { itemId: eggId, version: 3, mode: "amount", amountValue: 7, unit: "piece" },
  ]) await assert.rejects(() => runInventoryActions([inventoryAction("consume_inventory_items", { items: [consumption] })]));
  await assert.rejects(() => runInventoryActions([inventoryAction("consume_inventory_items", { itemIds: [eggId] })]));
  await assert.rejects(() => runInventoryActions([
    inventoryAction("consume_inventory_items", { items: [{ itemId: eggId, version: 3, mode: "amount", amountValue: 1, unit: "piece" }] }),
    inventoryAction("update_inventory_item", { itemId: 2147483647, version: 1, quantity: "2个" }),
  ]));
  assert.equal((await eggState()).quantity, "6个");
  assert.equal(Number((await eggState()).version), 3);
  await runInventoryActions([inventoryAction("update_inventory_item", { itemId: eggId, version: 3, quantity: "半袋" })]);
  assert.equal(Number((await eggState()).quantity_value), 0.5);
  assert.equal((await eggState()).quantity_unit, "bag");
  await runInventoryActions([inventoryAction("update_inventory_item", { itemId: eggId, version: 4, quantity: "数量未知" })]);
  assert.equal((await eggState()).quantity_value, null);
  assert.equal((await eggState()).quantity_unit, null);
  await assert.rejects(() => runInventoryActions([inventoryAction("consume_inventory_items", { items: [{ itemId: eggId, version: 5, mode: "amount", amountValue: 1, unit: "piece" }] })]));
  await runInventoryActions([inventoryAction("consume_inventory_items", { items: [{ itemId: eggId, version: 5, mode: "all" }] })]);
  assert.equal((await eggState()).is_available, false);

  const healthOperationRunId = `postgres-agent-operation-health-${householdMember}`;
  const healthOperationActionId = `${healthOperationRunId}-action`;
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [healthOperationRunId, householdMember]);
  const healthOperationProposal: ExecutableAgentAction = { id: healthOperationActionId, actionType: "record_health_log",
    riskLevel: "high", summary: "记录健康", payload: { weightKg: 60.7, waterMl: 500.4, recordedDate: "2025-09-01" } };
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'record_health_log','high','proposed',$4,$1)`,
  [healthOperationActionId, healthOperationRunId, householdMember, healthOperationProposal.payload]);
  const healthOperationResult = await operationsService.executeActions(householdMember, healthOperationRunId, [healthOperationProposal]);
  const healthOperationId = Number((healthOperationResult[0]?.result as { healthLogId: number }).healthLogId);
  assert.deepEqual((await pool.query("SELECT weight,water_ml,recorded_date FROM health_logs WHERE id=$1", [healthOperationId])).rows[0],
    { weight: 60.7, water_ml: 500, recorded_date: "2025-09-01" });
  const realtimeRepository = new PostgresRealtimeVoiceRepository(pool);
  const cancelledRealtimeRuns: string[] = [];
  const realtimeService = new RealtimeVoiceService(realtimeRepository, {
    transcribe: async () => ({ text: "  PostgreSQL 增量转写  " }),
    startRun: async (_userId, _input, _priority, onReplyDelta) => {
      await onReplyDelta?.("postgres-realtime-run", "保持中火");
      await onReplyDelta?.("postgres-realtime-run", "并持续翻炒。");
      return { run: { id: "postgres-realtime-run", status: "queued" } };
    },
    waitForRun: async (id) => ({ id, status: "completed", reply: "保持中火并持续翻炒。" }),
    cancelRun: async (_userId, runId) => { cancelledRealtimeRuns.push(runId); },
  });
  const realtimeInput = { recipeId: Number(queueRecipe.id), platform: "ios", idempotencyKey: "postgres-realtime-session-0001",
    currentStep: 1, recipeSteps: ["备菜", "翻炒"], recipeIngredients: ["番茄", "鸡蛋"] };
  const concurrentRealtimeSessions = await Promise.all([
    realtimeService.create(user.id, realtimeInput), realtimeService.create(user.id, realtimeInput),
  ]);
  assert.deepEqual(concurrentRealtimeSessions.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(concurrentRealtimeSessions[0]!.session.id, concurrentRealtimeSessions[1]!.session.id);
  const realtimeSessionId = concurrentRealtimeSessions[0]!.session.id;
  const mutedRealtime = await realtimeService.heartbeat(user.id, realtimeSessionId, { version: 1, muted: true, reconnect: true });
  assert.equal(mutedRealtime.session.version, 2);
  assert.equal(mutedRealtime.session.metrics.reconnects, 1);
  await assert.rejects(() => realtimeService.heartbeat(user.id, realtimeSessionId, { version: 1 }), /会话状态已更新/);
  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    realtimeRepository.emitEvent(realtimeSessionId, "integration.concurrent", { index })));
  const concurrentRealtimeEvents = await realtimeRepository.events(realtimeSessionId, 0);
  assert.deepEqual(concurrentRealtimeEvents.map((event) => event.sequence),
    Array.from({ length: concurrentRealtimeEvents.length }, (_, index) => index + 1));
  const audioInput = { turnId: "postgres-audio-turn", sequence: 1, audioBase64: "YXVkaW8=", mimeType: "audio/webm", final: true };
  assert.equal((await realtimeService.audio(user.id, realtimeSessionId, audioInput)).transcript, "PostgreSQL 增量转写");
  assert.equal((await realtimeService.audio(user.id, realtimeSessionId, audioInput)).repeated, true);
  const realtimeControl = await realtimeService.turn(user.id, realtimeSessionId,
    { turnId: "postgres-control-turn", transcript: "增加3分钟", currentStep: 1, timerSeconds: 0 });
  assert.deepEqual(realtimeControl.action, { action: "ADD_TIMER", seconds: 180 });
  const realtimeQuestion = await realtimeService.turn(user.id, realtimeSessionId,
    { turnId: "postgres-question-turn", transcript: "火候怎么控制", currentStep: 2, timerSeconds: 30 });
  assert.equal(realtimeQuestion.intent, "question");
  let realtimeResponseCompleted = false;
  for (let attempt = 0; attempt < 50 && !realtimeResponseCompleted; attempt += 1) {
    realtimeResponseCompleted = (await realtimeRepository.events(realtimeSessionId, 0))
      .some((event) => event.type === "response.completed");
    if (!realtimeResponseCompleted) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(realtimeResponseCompleted, true);
  const realtimeResponseDeltas = (await realtimeRepository.events(realtimeSessionId, 0))
    .filter((event) => event.type === "response.text.delta" && event.payload.turnId === "postgres-question-turn");
  assert.deepEqual(realtimeResponseDeltas.map((event) => event.payload.delta), ["保持中火", "并持续翻炒。"]);
  assert.equal(realtimeResponseDeltas.every((event) => event.payload.upstream === true), true);
  const realtimeNativeTypes = (await pool.query(`SELECT pg_typeof(s.context_json)::text AS context_type,
    pg_typeof(c.is_final)::text AS final_type, c.is_final FROM realtime_voice_sessions s
    JOIN realtime_voice_transcript_chunks c ON c.session_id=s.id WHERE s.id=$1`, [realtimeSessionId])).rows[0];
  assert.deepEqual(realtimeNativeTypes, { context_type: "jsonb", final_type: "boolean", is_final: true });
  assert.equal((await realtimeService.close(user.id, realtimeSessionId)).session.status, "closed");
  assert.equal(await realtimeRepository.appendResponseDelta({ sessionId: realtimeSessionId, userId: user.id,
    turnId: "postgres-question-turn", runId: "postgres-realtime-run", index: 2, delta: "不应写入", firstResponseMs: 1 }), false);
  assert.deepEqual(cancelledRealtimeRuns, ["postgres-realtime-run"]);
  const queueInput = {
    userId: user.id,
    recipeId: Number(queueRecipe.id),
    idempotencyKey: "postgres-queue-idempotency-0001",
    snapshot: { title: queueRecipe.title, ingredients: queueRecipe.ingredients_json },
  };
  const queued = await Promise.all([
    cookingQueueRepository.enqueue({ ...queueInput, id: "44444444-4444-4444-8444-444444444444" }, 30),
    cookingQueueRepository.enqueue({ ...queueInput, id: "55555555-5555-4555-8555-555555555555" }, 30),
  ]);
  assert.deepEqual(queued.map((result) => result.kind).sort(), ["created", "existing"]);
  if (queued[0]!.kind === "full" || queued[1]!.kind === "full") throw new Error("queue unexpectedly full");
  assert.equal(queued[0]!.row.id, queued[1]!.row.id);
  const firstQueueId = String(queued[0]!.row.id);
  const updatedQueue = await cookingQueueRepository.update(firstQueueId, user.id, 1, {
    status: "preparing", mealType: "dinner", plannedAt: null, preparedIngredients: ["番茄"],
    shoppingListSyncedAt: null, completedAt: null,
  });
  assert.equal(updatedQueue?.version, 2);
  assert.equal(await cookingQueueRepository.update(firstQueueId, user.id, 1, {
    status: "ready", mealType: null, plannedAt: null, preparedIngredients: [], shoppingListSyncedAt: null, completedAt: null,
  }), null);
  const secondRecipe = queueRecipes.rows[1]!;
  const secondQueued = await cookingQueueRepository.enqueue({
    id: "66666666-6666-4666-8666-666666666666", userId: user.id, recipeId: Number(secondRecipe.id),
    snapshot: { title: secondRecipe.title, ingredients: secondRecipe.ingredients_json },
  }, 30);
  assert.equal(secondQueued.kind, "created");
  const activeQueue = await cookingQueueRepository.list(user.id, false);
  const reorderedQueue = await cookingQueueRepository.reorder(user.id,
    [...activeQueue].reverse().map((item) => ({ id: String(item.id), version: Number(item.version) })));
  assert.equal(reorderedQueue?.[0]?.id, "66666666-6666-4666-8666-666666666666");
  const reorderedFirst = reorderedQueue!.find((item) => item.id === firstQueueId)!;
  const startedQueue = await cookingQueueRepository.transition(firstQueueId, user.id, Number(reorderedFirst.version), "cooking");
  const completedQueue = await cookingQueueRepository.transition(firstQueueId, user.id, Number(startedQueue!.version), "completed");
  assert.equal(completedQueue?.status, "completed");
  assert.equal(await cookingQueueRepository.cancel("66666666-6666-4666-8666-666666666666", user.id), true);

  const { verifyCancelledProduction } = await import("./helpers/cancelledProduction.js");
  await verifyCancelledProduction(dietService,user.id,async (sql,values=[]) => {
    let parameter = 0;
    return (await pool.query(sql.replace(/\?/g, () => `$${++parameter}`),values)).rows;
  });

  const mealPlanRepository = new PostgresMealPlansRepository(pool);
  const { verifyPreparedAllocations, verifyAllocationLifecycle } = await import("./helpers/preparedAllocations.js");
  await verifyAllocationLifecycle(mealPlanRepository, dietService, user.id, async operation => {
    const before = (await pool.query("SELECT COUNT(*) n FROM diet_records WHERE user_id=$1",[user.id])).rows[0].n;
    await pool.query(`CREATE FUNCTION ledger_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected allocation failure'; END $$;
      CREATE TRIGGER ledger_injected_failure BEFORE INSERT ON prepared_meal_events FOR EACH ROW WHEN (NEW.idempotency_key='ledger-injected-failure') EXECUTE FUNCTION ledger_injected_failure();`);
    try { await assert.rejects(operation(),/injected allocation failure/); }
    finally { await pool.query("DROP TRIGGER ledger_injected_failure ON prepared_meal_events; DROP FUNCTION ledger_injected_failure()"); }
    assert.equal((await pool.query("SELECT COUNT(*) n FROM diet_records WHERE user_id=$1",[user.id])).rows[0].n,before);
  });
  const allocationProduction = await dietService.completeCooking(user.id, {
    idempotency_key: "pg-prepared-active-allocation", inventory_item_ids: [], inventory_consumptions: [],
    production: { food_name: "份量安排", produced_servings: 1, eaten_servings: 0, meal_type: "", nutrition_per_serving: {} },
  });
  const allocationBatch = allocationProduction.prepared_meal as { id: string };
  await verifyPreparedAllocations(mealPlanRepository, user.id, allocationBatch.id, async () => {
    assert.equal(Number((await pool.query("SELECT remaining_servings FROM prepared_meals WHERE id=$1", [allocationBatch.id])).rows[0].remaining_servings), 1);
    await pool.query("UPDATE prepared_meals SET version=version+1 WHERE id=$1", [allocationBatch.id]);
  });

  const protectedPlanId = "19500000-0000-4000-8000-000000000001";
  const protectedItemId = "19500000-0000-4000-8000-000000000002";
  const replacementDate = new Date();
  const replacementToday = currentDateKey(replacementDate);
  const replacementTomorrow = dateKeyAfterDays(1, replacementDate);
  const replacementWeekEnd = dateKeyAfterDays(6, replacementDate);
  // Keep these reviewed fixtures independent from earlier legacy commitments and health profiles.
  const seedReviewedMeal = async (planId: string, itemId: string, title: string, foodName: string, amount: number, weekly = false) => {
    const ownerId = Number((await pool.query("INSERT INTO users(username,password_hash) VALUES($1,'unused-test-hash') RETURNING id", [randomUUID()])).rows[0].id);
    const recipe = (await pool.query(`INSERT INTO recipes(title,status,quality_status,serving_size,cook_time,prep_time,ingredients_json,steps_json)
      VALUES($1,'approved','trusted',2,10,5,$2::jsonb,$3::jsonb) RETURNING *`,
      [title, JSON.stringify([{ name: foodName, amount: `${amount}g` }]), JSON.stringify(["准备", "煮熟", "收尾"])])).rows[0];
    const execution = { recipeKey: executionRecipeKey(recipe), reviewedBy: user.id, reviewedAt: replacementDate.toISOString(),
      profile: { ...executionFixture, handling: { storage: "fresh_only", maxHoldHours: 0, coldServingAllowed: true, carryAllowed: false,
        sourceUrl: "https://example.invalid/review", reference: "合成测试存放依据", instructions: "仅用于自动测试，不代表真实食品安全保证" } } };
    await pool.query("UPDATE recipes SET execution_json=$1::jsonb WHERE id=$2", [JSON.stringify(execution), recipe.id]);
    const constraints = {
      executionItems: { [itemId]: { targetMealId: `target-${itemId}`, recipeId: Number(recipe.id), title, servings: 2, recipeYield: 2,
        demands: [{ food_name: foodName, amount_value: amount, unit: "g" }] } },
      executionRecipeKeys: { [itemId]: recipeExecutionProof({ ...recipe, execution_json: execution }) },
      currentCookingDraft: { productionDate: replacementToday, ...(weekly ? { planningMode: "weekly" } : {}), time: { budgetMinutes: 60 } },
    };
    await pool.query(`INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status,constraints_json)
      VALUES($1,$2,$3,$4,$5,'active',$6::jsonb)`, [planId,ownerId,title,replacementToday,replacementWeekEnd,JSON.stringify(constraints)]);
    await pool.query(`INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json)
      VALUES($1,$2,$3,$4,'午餐',$5,$6,$7::jsonb,$8::jsonb)`,
      [itemId,planId,ownerId,replacementToday,title,recipe.id,JSON.stringify(recipe.ingredients_json),JSON.stringify(recipe.steps_json)]);
    const stockId = Number((await pool.query(`INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,is_available,expiration_date)
      VALUES($1,$2,'其他',$3,$4,'g',TRUE,$5) RETURNING id`, [ownerId,foodName,`${amount * 3}g`,amount * 3,replacementWeekEnd])).rows[0].id);
    await pool.query("INSERT INTO kitchenware_items(user_id,name,category,catalog_id,attributes_json) VALUES($1,'测试锅','锅具',1,$2::jsonb)", [ownerId,JSON.stringify({ capacityMl: 1000 })]);
    await pool.query("INSERT INTO user_health_profiles(user_id,kitchen_constraints_json) VALUES($1,$2::jsonb)", [ownerId,JSON.stringify({ meal_time_minutes: 60 })]);
    return { ownerId, stockId, recipeId: Number(recipe.id) };
  };
  const { ownerId: protectedUserId, stockId: protectedStockId, recipeId: protectedRecipeId } = await seedReviewedMeal(protectedPlanId,protectedItemId,"PG保护计划","米",100);
  const protectedState = async () => ({
    plan: (await pool.query("SELECT * FROM meal_plans WHERE id=$1",[protectedPlanId])).rows,
    items: (await pool.query("SELECT * FROM meal_plan_items WHERE plan_id=$1 ORDER BY id",[protectedPlanId])).rows,
    changes: (await pool.query("SELECT * FROM meal_plan_changes WHERE plan_id=$1 ORDER BY id",[protectedPlanId])).rows,
  });
  const initialProtectedState = await protectedState();
  await assert.rejects(mealPlanRepository.updateItem(protectedUserId,protectedPlanId,protectedItemId,{ version: 1,mealType: "晚餐" },"worker","规则调整"), { code: "MEAL_PLAN_PREVIEW_REQUIRED" });
  assert.deepEqual(await protectedState(),initialProtectedState);
  const stalePreview = await mealPlanRepository.previewChange(protectedUserId,protectedPlanId,protectedItemId,{ patch: { version: 1,mealType: "晚餐" } });
  assert.equal(stalePreview?.canApply,true,JSON.stringify(stalePreview?.checks));
  await pool.query("UPDATE inventory_items SET quantity_value=quantity_value-1,version=version+1 WHERE id=$1",[protectedStockId]);
  const staleProtectedState = await protectedState();
  await assert.rejects(mealPlanRepository.updateItem(protectedUserId,protectedPlanId,protectedItemId,{ version: 1,mealType: "晚餐",validationFingerprint: stalePreview!.fingerprint },"worker","规则调整"), { code: "MEAL_PLAN_PREVIEW_CHANGED" });
  assert.deepEqual(await protectedState(),staleProtectedState);
  const autoPreview = await mealPlanRepository.previewChange(protectedUserId,protectedPlanId,protectedItemId,{ patch: { version: 1,mealType: "晚餐" } });
  assert.equal(autoPreview?.canApply,true,JSON.stringify(autoPreview?.checks));
  const autoChange = await mealPlanRepository.updateItem(protectedUserId,protectedPlanId,protectedItemId,{ version: 1,mealType: "晚餐",validationFingerprint: autoPreview!.fingerprint },"worker","规则调整");
  assert.equal(autoChange.kind,"updated");
  if (autoChange.kind !== "updated") throw new Error("auto change failed");
  assert.equal((autoChange.value.change as Record<string,unknown>).status,"applied");
  const autoId = String((autoChange.value.change as Record<string,unknown>).id);
  const restorePreview = await mealPlanRepository.previewChange(protectedUserId,protectedPlanId,protectedItemId,{ changeId: autoId,action: "restore" });
  assert.equal(restorePreview?.canApply,true,JSON.stringify(restorePreview?.checks));
  assert.equal((await mealPlanRepository.reviewChange(protectedUserId,protectedPlanId,autoId,"restore",restorePreview!.fingerprint)).kind,"updated");
  await mealPlanRepository.confirmItem(protectedUserId,protectedPlanId,protectedItemId,3);
  const suggestion = await mealPlanRepository.updateItem(protectedUserId,protectedPlanId,protectedItemId,{ version: 4,mealType: "早餐" },"worker","条件变化");
  if (suggestion.kind !== "updated") throw new Error("suggestion failed");
  assert.equal((suggestion.value.change as Record<string,unknown>).status,"pending");
  const changeId = String((suggestion.value.change as Record<string,unknown>).id);
  const acceptPreview = await mealPlanRepository.previewChange(protectedUserId,protectedPlanId,protectedItemId,{ changeId,action: "accept" });
  assert.equal(acceptPreview?.canApply,true,JSON.stringify(acceptPreview?.checks));
  const reviews = await Promise.all([mealPlanRepository.reviewChange(protectedUserId,protectedPlanId,changeId,"accept",acceptPreview!.fingerprint),mealPlanRepository.reviewChange(protectedUserId,protectedPlanId,changeId,"accept",acceptPreview!.fingerprint)]);
  assert.deepEqual(reviews.map(result => result.kind),["updated","updated"]);
  assert.equal((await pool.query("SELECT version FROM meal_plan_items WHERE id=$1",[protectedItemId])).rows[0].version,5);
  await pool.query("INSERT INTO shopping_list_items(id,user_id,client_id,name,checked) VALUES('pg-protection-purchase',$1,$2,'米',TRUE)",[protectedUserId,`meal-plan:${protectedItemId}:米`]);
  assert.equal((await mealPlanRepository.reviewChange(protectedUserId,protectedPlanId,changeId,"restore")).kind,"protected");
  const rejectedSuggestion = await mealPlanRepository.updateItem(protectedUserId,protectedPlanId,protectedItemId,{ version: 5,mealType: "晚餐" });
  if (rejectedSuggestion.kind !== "updated") throw new Error("suggestion failed");
  const rejectedId = String((rejectedSuggestion.value.change as Record<string,unknown>).id);
  await mealPlanRepository.reviewChange(protectedUserId,protectedPlanId,rejectedId,"reject");
  const replayRejected = await mealPlanRepository.updateItem(protectedUserId,protectedPlanId,protectedItemId,{ version: 5,mealType: "晚餐" });
  if (replayRejected.kind !== "updated") throw new Error("replay failed");
  assert.equal((replayRejected.value.change as Record<string,unknown>).status,"rejected");
  await pool.query("UPDATE meal_plan_items SET status='cooking' WHERE id=$1",[protectedItemId]);
  const blockedChange = await mealPlanRepository.updateItem(protectedUserId,protectedPlanId,protectedItemId,{ version: 5,plannedDate: replacementTomorrow });
  if (blockedChange.kind !== "updated") throw new Error("blocked result missing");
  assert.equal((blockedChange.value.change as Record<string,unknown>).status,"blocked");
  assert.equal((await mealPlanRepository.updatePlan(protectedUserId,protectedPlanId,{ version: 1,title: "安全改标题" })).kind,"updated");
  await assert.rejects(mealPlanRepository.updatePlan(protectedUserId,protectedPlanId,{ version: 2,startDate: replacementTomorrow }),/原安排已保留/);
  await assert.rejects(mealPlanRepository.removePlan(protectedUserId,protectedPlanId,2),/原安排已保留/);
  const protectedRunId = "19500000-0000-4000-8000-000000000003";
  await pool.query("INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id) VALUES($1,$2,'guard','text','assistant','running','{}',$1)",[protectedRunId,protectedUserId]);
  await pool.query("UPDATE meal_plans SET version=1,created_by_run_id=$1 WHERE id=$2",[protectedRunId,protectedPlanId]);
  await pool.query("INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,result_json,idempotency_key,executed_at) VALUES('195-action',$1,$2,'create_meal_plan','high','executed','{}',$3::jsonb,'195-undo-key',CURRENT_TIMESTAMP)",[protectedRunId,protectedUserId,JSON.stringify({ planId: protectedPlanId })]);
  await assert.rejects(new PostgresAgentOperationsRepository(pool).undoActions(protectedUserId,protectedRunId),/原安排已保留/);


  const savedDraftInput: SaveCookingPlanDraftInput = {
    id: "7cd0c614-438c-45ab-a3cc-50507798a194", title: "可恢复草案",
    draft: { status: "requires_validation", meals: [{ id: "dinner", date: "2026-09-09", mealType: "dinner",
      servings: 1, preparedServings: 0, cookServings: 1, allocations: [] }], totalCookServings: 1,
    cooking: [], unresolved: [{ targetMealId: "dinner", reason: "待选菜" }], ingredientBudget: [],
    time: { budgetMinutes: 30, knownSequentialMinutes: 0, exceedsBudget: false, isEstimate: true, incomplete: true, missing: ["cleanup"] },
    checksPending: ["whole_plan_time"], excludedPreparedMealIds: [], effectivePreferences: {} },
  };
  const concurrentDraftSaves = await Promise.all([
    mealPlanRepository.saveDraft(user.id, savedDraftInput), mealPlanRepository.saveDraft(user.id, savedDraftInput),
  ]);
  assert.deepEqual(concurrentDraftSaves.map(value => value?.repeated).sort(), [false, true]);
  assert.equal(await mealPlanRepository.saveDraft(user.id, { ...savedDraftInput, title: "不同请求" }), null);
  const restoredDraft = await new PostgresMealPlansRepository(pool).find(user.id, savedDraftInput.id, false);
  assert.deepEqual((restoredDraft?.constraints as Record<string, unknown>).savedCookingDraft,
    { title: savedDraftInput.title, draft: savedDraftInput.draft });
  const draftUpdateInput = { version: Number(restoredDraft!.version), idempotencyKey: "492b38e1-9535-415a-a12a-a64c5595c194",
    draft: { ...savedDraftInput.draft, meals: savedDraftInput.draft.meals.map(meal => ({ ...meal, date: "2026-09-10" })) } };
  const duplicateDraftUpdates = await Promise.all([
    mealPlanRepository.updateDraft(user.id, savedDraftInput.id, draftUpdateInput),
    mealPlanRepository.updateDraft(user.id, savedDraftInput.id, draftUpdateInput),
  ]);
  assert(duplicateDraftUpdates.every(result => result.kind === "updated"));
  assert.deepEqual(duplicateDraftUpdates.map(result => result.kind === "updated" ? result.value.repeated : null).sort(), [false, true]);
  assert.equal((await mealPlanRepository.updateDraft(user.id, savedDraftInput.id,
    { ...draftUpdateInput, idempotencyKey: "512e3d42-ea82-4d4f-8932-11f96dace194" })).kind, "version_conflict");
  const updatedDraftPlan = await mealPlanRepository.find(user.id, savedDraftInput.id, false);
  assert.equal(updatedDraftPlan!.version, Number(restoredDraft!.version) + 1);
  assert.deepEqual((updatedDraftPlan!.constraints as Record<string, unknown>).currentCookingDraft, draftUpdateInput.draft);


  const activationRecipe = (await pool.query("INSERT INTO recipes(title,status,ingredients_json,steps_json,serving_size) VALUES('PG激活回归','approved','[{\"name\":\"番茄\",\"amount\":\"200g\"}]','[]',1) RETURNING id,title")).rows[0];
  const activationInput: SaveCookingPlanDraftInput = { ...savedDraftInput, id: "1b5e226a-8e80-413b-bf8e-bfe60cf43194",
    draft: { ...savedDraftInput.draft, unresolved: [], cooking: [{ targetMealId: "dinner", recipeId: Number(activationRecipe.id),
      title: String(activationRecipe.title), servings: 1, recipeYield: 1, demands: [{ food_name: "番茄", amount_value: 200, unit: "g" }] }] } };
  const lockDraft = { ...activationInput,id: "19600000-0000-4000-8000-000000000099",draft: { ...activationInput.draft,planningMode: "weekly" as const,meals: activationInput.draft.meals.map(meal => ({ ...meal,date: "2099-09-12" })) } };
  await mealPlanRepository.saveDraft(user.id,lockDraft);
  const blocker = await pool.connect();
  const { lockMealPlanning } = await import("../src/modules/mealPlans/postgresLock.js");
  await blocker.query("BEGIN");
  await lockMealPlanning(blocker,user.id);
  const blockedActivation = mealPlanRepository.activateDraft(user.id,lockDraft.id,1);
  const blockedAgent = new PostgresAgentOperationsRepository(pool).executeActions(user.id,"missing-lock-probe",[]).catch(error => error as Error);
  let observedWait = false;
  try {
    for (let attempt=0;attempt<100;attempt++) {
      const waiting = await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");
      if (Number(waiting.rowCount) >= 2) { observedWait = true; break; }
      await new Promise(resolve => setTimeout(resolve,10));
    }
    await blocker.query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,status) VALUES('weekly-concurrent-plan',$1,'并发安排','2099-09-12','2099-09-12','active')",[user.id]);
    await blocker.query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title) VALUES('weekly-concurrent-item','weekly-concurrent-plan',$1,'2099-09-12','晚餐','已安排')",[user.id]);
    await blocker.query("COMMIT");
  } catch (error) { await blocker.query("ROLLBACK"); throw error; }
  finally { blocker.release(); }
  assert.equal((await blockedActivation).kind,"version_conflict");
  assert.match(String(await blockedAgent),/Agent Run 已取消/);
  assert.equal(observedWait,true,"activation must wait for the competing meal writer before reading occupancy");
  await mealPlanRepository.saveDraft(user.id, activationInput);
  const activatedDrafts = await Promise.all([
    mealPlanRepository.activateDraft(user.id, activationInput.id, 1), mealPlanRepository.activateDraft(user.id, activationInput.id, 1),
  ]);
  assert(activatedDrafts.every(result => result.kind === "updated"));
  assert.deepEqual(activatedDrafts.map(result => result.kind === "updated" ? result.value.repeated : null).sort(), [false,true]);
  const activatedPlan = await mealPlanRepository.find(user.id, activationInput.id, false);
  assert.equal(activatedPlan?.status, "active");
  assert.equal((activatedPlan?.items as Array<Record<string, unknown>>).length, 1);
  assert.equal((activatedPlan?.items as Array<Record<string, unknown>>)[0].plannedServings, 1);

  const activatedItem = (activatedPlan!.items as Array<Record<string, unknown>>)[0]!;
  const firstPlanQueue = await mealPlanRepository.enqueue(user.id, activationInput.id, String(activatedItem.id),
    { version: Number(activatedItem.version), idempotencyKey: "pg-activated-first-queue" });
  assert.equal(firstPlanQueue.kind, "completed");
  const anotherActivation = { ...activationInput, id: "68505c87-3aac-43bc-9bdd-53402ed66194" };
  await mealPlanRepository.saveDraft(user.id, anotherActivation);
  await mealPlanRepository.activateDraft(user.id, anotherActivation.id, 1);
  const anotherPlan = await mealPlanRepository.find(user.id, anotherActivation.id, false);
  const anotherItem = (anotherPlan!.items as Array<Record<string, unknown>>)[0]!;
  assert.equal((await mealPlanRepository.enqueue(user.id, anotherActivation.id, String(anotherItem.id),
    { version: Number(anotherItem.version), idempotencyKey: "pg-activated-second-queue" })).kind, "completed");
  const separateQueues = await pool.query("SELECT * FROM cooking_queue_items WHERE source_plan_item_id = ANY($1::text[])",
    [[activatedItem.id, anotherItem.id]]);
  assert.equal(separateQueues.rows.length, 2);
  assert(separateQueues.rows.every(row => row.recipe_snapshot_json.plannedServings === 1));

  const mealPlanId = "77777777-7777-4777-8777-777777777777";
  const mealPlanItemId = "88888888-8888-4888-8888-888888888888";
  const { ownerId: mealPlanUserId, stockId: mealPlanStockId, recipeId: mealPlanRecipeId } = await seedReviewedMeal(mealPlanId,mealPlanItemId,"Postgres 餐单料理","Postgres 餐单专用姜",10,true);
  await pool.query("UPDATE meal_plan_items SET meal_type='晚餐',calories=260,protein=15,carbs=20,fat=12 WHERE id=$1",[mealPlanItemId]);
  assert.equal((await mealPlanRepository.list(user.id + 1, false)).length, 0);
  const initialMealPlan = await mealPlanRepository.find(mealPlanUserId, mealPlanId, false);
  assert.equal(initialMealPlan?.items instanceof Array, true);
  const datePreview = await mealPlanRepository.previewChange(mealPlanUserId,mealPlanId,mealPlanItemId,{ patch: { version: 1,plannedDate: replacementTomorrow } });
  assert.equal(datePreview?.canApply,true,JSON.stringify(datePreview?.checks));
  const updatedMealPlanItem = await mealPlanRepository.updateItem(mealPlanUserId, mealPlanId, mealPlanItemId, {
    version: 1, plannedDate: replacementTomorrow, validationFingerprint: datePreview!.fingerprint,
  });
  assert.equal(updatedMealPlanItem.kind, "updated");
  assert.equal((await mealPlanRepository.updateItem(mealPlanUserId, mealPlanId, mealPlanItemId, {
    version: 1, plannedDate: dateKeyAfterDays(2,replacementDate),
  })).kind, "version_conflict");
  // Stock can change after date validation; retain the original missing-ingredient shopping coverage.
  await pool.query("UPDATE inventory_items SET is_available=FALSE,version=version+1 WHERE id=$1",[mealPlanStockId]);
  const shoppingResults = await Promise.all([
    mealPlanRepository.addShopping(mealPlanUserId, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-shopping-0001",
    }),
    mealPlanRepository.addShopping(mealPlanUserId, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-shopping-0001",
    }),
  ]);
  const shoppingValues = shoppingResults.map((result) => {
    if (result.kind !== "completed") throw new Error("meal plan shopping failed");
    return result.value as Record<string, unknown> & { repeated: boolean };
  });
  assert.deepEqual(shoppingValues.map((result) => result.repeated).sort(), [false, true]);
  assert.equal((await pool.query(`SELECT COUNT(*)::integer AS count FROM shopping_list_items
    WHERE user_id = $1 AND client_id LIKE $2`, [mealPlanUserId, `meal-plan:${mealPlanItemId}:%`])).rows[0]?.count, 1);
  const mealQueueResults = await Promise.all([
    mealPlanRepository.enqueue(mealPlanUserId, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-queue-0001",
    }),
    mealPlanRepository.enqueue(mealPlanUserId, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-queue-0001",
    }),
  ]);
  const mealQueueValues = mealQueueResults.map((result) => {
    if (result.kind !== "completed") throw new Error("meal plan queue failed");
    return result.value as Record<string, unknown> & { repeated: boolean };
  });
  assert.deepEqual(mealQueueValues.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(mealQueueValues[0]!.queueItemId, mealQueueValues[1]!.queueItemId);
  const mealCompletionResults = await Promise.all([
    mealPlanRepository.complete(mealPlanUserId, mealPlanId, mealPlanItemId, {
      version: 3, idempotencyKey: "postgres-meal-plan-complete-0001",
    }),
    mealPlanRepository.complete(mealPlanUserId, mealPlanId, mealPlanItemId, {
      version: 3, idempotencyKey: "postgres-meal-plan-complete-0001",
    }),
  ]);
  const mealCompletionValues = mealCompletionResults.map((result) => {
    if (result.kind !== "completed") throw new Error("meal plan completion failed");
    return result.value as Record<string, unknown> & { repeated: boolean };
  });
  assert.deepEqual(mealCompletionValues.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(mealCompletionValues[0]!.dietRecordId, mealCompletionValues[1]!.dietRecordId);
  const updatedMealPlan = await mealPlanRepository.updatePlan(mealPlanUserId, mealPlanId, { version: 1, title: "Postgres 已更新餐单" });
  assert.equal(updatedMealPlan.kind, "updated");
  assert.equal((await mealPlanRepository.removePlan(user.id + 1, mealPlanId, 2)), "not_found");
  assert.equal((await mealPlanRepository.removePlan(mealPlanUserId, mealPlanId, 2)), "removed");
  assert.equal(await mealPlanRepository.find(mealPlanUserId, mealPlanId, false), null);
  assert.equal((await mealPlanRepository.find(mealPlanUserId, mealPlanId, true))?.archived, true);
  // Recipe candidates are global: retire this fixture after its lifecycle assertions without removing referenced rows.
  await pool.query("UPDATE recipes SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1",[mealPlanRecipeId]);

  const voicePacksRepository = new PostgresVoicePacksRepository(pool);
  const voicePacksService = new VoicePacksService(voicePacksRepository);
  const voiceManifest = {
    voiceId: "postgres-licensed-zh", name: "Postgres 授权音色", version: "1.0.0", language: "zh-CN",
    sampleRate: 22050, outputFormat: "pcm-f32" as const, minimumAppVersion: "1.0.0", minimumMemoryMb: 512,
    license: { name: "Apache-2.0", url: "https://example.com/license", speakerAuthorization: "postgres-record", modelNotice: "extractable" },
    resources: [{ path: "model.onnx", url: "https://example.com/model.onnx", sha256: "c".repeat(64), bytes: 1024 }],
    model: { path: "model.onnx", vocabularyPath: "model.onnx", inputNames: { tokens: "tokens", lengths: "lengths" } },
  };
  const createdVoice = await voicePacksService.create(user.id, { manifest: voiceManifest, providerVoice: "alloy" }, {});
  const voiceId = Number(createdVoice.id);
  const preferenceCreates = await Promise.all([
    voicePacksRepository.updatePreference(user.id, 0, null, null, "automatic"),
    voicePacksRepository.updatePreference(user.id, 0, null, null, "automatic"),
  ]);
  assert.equal(preferenceCreates.filter(Boolean).length, 1);
  const publishAudit = { adminUserId: user.id, action: "voice_pack.published", resourceId: voiceId, summary: "Postgres publish" };
  const publishes = await Promise.all([
    voicePacksRepository.transition(user.id, voiceId, 1, "draft", "published", "发布审核通过", publishAudit),
    voicePacksRepository.transition(user.id, voiceId, 1, "draft", "published", "发布审核通过", publishAudit),
  ]);
  assert.equal(publishes.filter(Boolean).length, 1);
  const catalog = await voicePacksService.catalog("1.0.0");
  assert.equal(catalog.items.some((item) => item.voiceId === voiceManifest.voiceId), true);
  const preference = await voicePacksRepository.preference(user.id);
  const revokeAudit = { adminUserId: user.id, action: "voice_pack.revoked", resourceId: voiceId, summary: "Postgres revoke" };
  const [selected, revokedVoice] = await Promise.all([
    voicePacksRepository.updatePreference(user.id, preference.version, voiceManifest.voiceId, voiceManifest.version, "automatic"),
    voicePacksRepository.transition(user.id, voiceId, 2, "published", "revoked", "紧急撤销测试", revokeAudit),
  ]);
  assert.equal(revokedVoice?.status, "revoked");
  const clearedPreference = await voicePacksRepository.preference(user.id);
  assert.equal(clearedPreference.selectedVoiceId, null);
  assert.equal(clearedPreference.version, selected ? selected.version + 1 : preference.version);
  assert.equal((await voicePacksRepository.history(voiceId)).length, 3);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE resource_type = 'voice_pack_version' AND resource_id = $1`, [String(voiceId)])).rows[0]?.count), 3);

  await pool.query("INSERT INTO proactive_intervention_preferences(user_id) VALUES($1)",[user.id]);
  assert.deepEqual((await pool.query("SELECT enabled,expiry_rescue,dinner_window FROM proactive_intervention_preferences WHERE user_id=$1",[user.id])).rows[0],{ enabled: 0,expiry_rescue: 0,dinner_window: 0 });
  await pool.query("INSERT INTO proactive_interventions(id,user_id,source_key,kind,candidate_json,starts_at,expires_at) VALUES('pg-intervention',$1,'expiry-day','expiry_rescue','{}'::jsonb,'2026-09-12T00:00:00Z','2026-09-13T00:00:00Z')",[user.id]);
  await assert.rejects(pool.query("INSERT INTO proactive_interventions(id,user_id,source_key,kind,candidate_json,starts_at,expires_at) VALUES('pg-duplicate',$1,'expiry-day','expiry_rescue','{}'::jsonb,'2026-09-12T00:00:00Z','2026-09-13T00:00:00Z')",[user.id]),(error: unknown) => (error as {code:string}).code === '23505');
  const otherInterventionUser = Number((await pool.query("SELECT id FROM users WHERE id<>$1 LIMIT 1",[user.id])).rows[0].id);
  const insertInterventionAction = (id: string,owner: number) => pool.query("INSERT INTO proactive_intervention_actions(id,intervention_id,user_id,idempotency_key,action,request_json,result_json) VALUES($1,'pg-intervention',$2,'once','snooze','{}'::jsonb,'{}'::jsonb)",[id,owner]);
  await assert.rejects(insertInterventionAction('pg-cross',otherInterventionUser),(error: unknown) => (error as {code:string}).code === '23503');
  await insertInterventionAction('pg-action',user.id);
  await assert.rejects(insertInterventionAction('pg-repeat',user.id),(error: unknown) => (error as {code:string}).code === '23505');
  await assert.rejects(pool.query("INSERT INTO proactive_intervention_outcomes(id,intervention_id,user_id,outcome_type,source_type,source_id,occurred_at) VALUES('pg-cross-outcome','pg-intervention',$1,'cooking_started','queue','1',CURRENT_TIMESTAMP)",[otherInterventionUser]),(error: unknown) => (error as {code:string}).code === '23503');

  const kitchenwareRepository = new PostgresKitchenwareRepository(pool);
  const kitchenwareService = new KitchenwareService(kitchenwareRepository);
  const postgresCatalog = await kitchenwareService.catalog("不粘锅");
  assert.equal(postgresCatalog[0]?.name, "平底锅");
  assert.equal(postgresCatalog[0]?.capabilities.some((capability) => capability.code === "fry"), true);
  const postgresPan = await kitchenwareService.create(user.id, {
    name: "不粘锅", category: "烹饪锅具", status: "需保养", note: "Postgres 厨具",
    image_url: "", purchase_date: "2026-08-31",
  });
  assert.equal(postgresPan.name, "平底锅");
  const panAttributes = { capacityMl: 3000,diameterCm: 28,heatSources: ["induction"] };
  assert.deepEqual((await kitchenwareService.update(user.id,Number(postgresPan.id),{ name: "平底锅",attributes: panAttributes })).attributes,panAttributes);
  assert.deepEqual((await kitchenwareService.update(user.id,Number(postgresPan.id),{ name: "平底锅",note: "preserve" })).attributes,panAttributes);
  assert.deepEqual((await kitchenwareService.list(user.id)).find(item => Number(item.id) === Number(postgresPan.id))?.attributes,panAttributes);
  assert.deepEqual((await kitchenwareService.update(user.id,Number(postgresPan.id),{ name: "平底锅",attributes: { capacityMl: null,heatSources: null } })).attributes,{ capacityMl: null,heatSources: null });

  assert.equal((await kitchenwareRepository.listItems(user.id + 1)).length, 0);
  assert.equal(await kitchenwareRepository.findOwnedItem(user.id + 1, Number(postgresPan.id)), null);
  await pool.query("INSERT INTO kitchenware_capabilities(code,name,safety_level) VALUES('spec_test','规格测试','normal')");
  await pool.query("INSERT INTO kitchenware_catalog_capabilities(catalog_id,capability_code,constraints_json) VALUES($1,'spec_test',$2::jsonb)",
    [postgresPan.catalog_id,JSON.stringify({ minCapacityMl: 3000,minDiameterCm: 28,heatSource: "induction" })]);
  const specificationRecipe = Number((await pool.query("INSERT INTO recipes(title,ingredients_json,steps_json) VALUES('规格约束验证','[]'::jsonb,'[]'::jsonb) RETURNING id")).rows[0].id);
  await pool.query("INSERT INTO recipe_kitchenware_requirements(recipe_id,capability_code,role,confidence) VALUES($1,'spec_test','required',1)",[specificationRecipe]);
  assert.equal((await kitchenwareService.evaluateRequirements(user.id,specificationRecipe)).blocking.length,1);
  await kitchenwareService.update(user.id,Number(postgresPan.id),{ name: "平底锅",attributes: panAttributes });
  assert.equal((await kitchenwareService.evaluateRequirements(user.id,specificationRecipe)).blocking.length,0);
  await kitchenwareService.update(user.id,Number(postgresPan.id),{ name: "平底锅",attributes: { ...panAttributes,heatSources: ["gas"] } });
  assert.equal((await kitchenwareService.evaluateRequirements(user.id,specificationRecipe)).blocking.length,1);
  const maintainedPan = await kitchenwareRepository.maintainItem(user.id, Number(postgresPan.id));
  assert.equal(maintainedPan?.status, "良好");

  const adminKitchenwareRepository = new PostgresAdminKitchenwareRepository(pool);
  const adminKitchenwareService = new AdminKitchenwareService(adminKitchenwareRepository);
  const adminKitchenwareContext = { adminUserId: user.id, ipAddress: "127.0.0.1", userAgent: "postgres-integration" };
  const adminCatalog = await adminKitchenwareService.createCatalog({
    name: "Postgres 管理炖锅", category: "烹饪锅具", aliases: ["PG 炖锅"], cooking_methods: ["炖"], care_note: "保持干燥",
  }, adminKitchenwareContext);
  const capabilityBefore = await adminKitchenwareService.capabilityConfiguration(Number(adminCatalog.id));
  const capabilityPayload = { token: capabilityBefore.token,capabilities: [{ code: "boil",constraints: { minCapacityMl: 2000 } }] };
  const concurrentCapabilities = await Promise.allSettled([
    adminKitchenwareService.updateCapabilities(Number(adminCatalog.id),capabilityPayload,adminKitchenwareContext),
    adminKitchenwareService.updateCapabilities(Number(adminCatalog.id),capabilityPayload,adminKitchenwareContext),
  ]);
  assert.equal(concurrentCapabilities.filter(result => result.status === "fulfilled").length,1);
  const rejectedCapability = concurrentCapabilities.find(result => result.status === "rejected");
  assert.equal(rejectedCapability?.status === "rejected" ? rejectedCapability.reason.status : null,409);
  const capabilityAfter = await adminKitchenwareService.capabilityConfiguration(Number(adminCatalog.id));
  assert.deepEqual(capabilityAfter.capabilities,capabilityPayload.capabilities);
  await assert.rejects(adminKitchenwareService.updateCapabilities(Number(adminCatalog.id),{ token: capabilityAfter.token,capabilities: [{ code: "nonexistent",constraints: {} }] },adminKitchenwareContext));
  assert.equal((await adminKitchenwareService.capabilityConfiguration(Number(adminCatalog.id))).token,capabilityAfter.token);
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM admin_audit_logs WHERE action='kitchenware_capabilities.update' AND resource_id=$1",[String(adminCatalog.id)])).rows[0].n),1);
  assert.equal(adminCatalog.aliases, '["PG 炖锅"]');
  assert.equal((await adminKitchenwareService.catalog({ search: "PG 炖锅" })).some((item) => Number(item.id) === Number(adminCatalog.id)), true);
  await assert.rejects(() => adminKitchenwareService.createCatalog({
    name: "Postgres 管理炖锅", category: "烹饪锅具", aliases: [], cooking_methods: [], care_note: "",
  }, adminKitchenwareContext), /已存在/);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE action='kitchenware_catalog.create' AND resource_id=$1`, [String(adminCatalog.id)])).rows[0]?.count), 1);
  const updatedAdminCatalog = await adminKitchenwareService.updateCatalog(Number(adminCatalog.id), {
    name: "Postgres 管理汤锅", category: "烹饪锅具", aliases: ["PG 汤锅"], cooking_methods: ["煮", "炖"], care_note: "擦干",
  }, adminKitchenwareContext);
  assert.equal(updatedAdminCatalog.cooking_methods, '["煮","炖"]');
  const moderatedAsset = await kitchenwareService.create(user.id, {
    name: "Postgres 管理资产", category: "其他", status: "良好", note: "moderation", image_url: "", purchase_date: "",
  });
  await adminKitchenwareService.updateAssetStatus(Number(moderatedAsset.id), "需保养", adminKitchenwareContext);
  assert.equal((await pool.query("SELECT status FROM kitchenware_items WHERE id=$1", [moderatedAsset.id])).rows[0]?.status, "需保养");
  await adminKitchenwareService.removeAsset(Number(moderatedAsset.id), adminKitchenwareContext);
  assert((await pool.query("SELECT deleted_at FROM kitchenware_items WHERE id=$1", [moderatedAsset.id])).rows[0]?.deleted_at);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE resource_type='kitchenware' AND resource_id=$1`, [String(moderatedAsset.id)])).rows[0]?.count), 2);
  await adminKitchenwareService.removeCatalog(Number(adminCatalog.id), adminKitchenwareContext);

  const mappingRaw = "PG映射审核专用炉";
  const mappingCatalog = Number((await pool.query("SELECT id FROM kitchenware_catalog WHERE name='烤箱'")).rows[0].id);
  const mappingRecipe = Number((await pool.query("INSERT INTO recipes(title,ingredients_json,steps_json,required_kitchenware_json,optional_kitchenware_json) VALUES('PG映射审核','[]'::jsonb,'[]'::jsonb,$1::jsonb,'[]'::jsonb) RETURNING id",[JSON.stringify([mappingRaw])])).rows[0].id);
  const mappingId = Number((await pool.query("INSERT INTO kitchenware_mapping_reviews(raw_name,normalized_name,source_type,source_id,confidence) VALUES($1,$3,'recipe',$2,0.72) RETURNING id",[mappingRaw,String(mappingRecipe),mappingRaw.toLowerCase()])).rows[0].id);
  const mappingRow = (await adminKitchenwareService.mappingReviews({})).items.find(row => Number(row.id) === mappingId)!;
  const mappingDecision = { token: mappingRow.token,decision: "approved",catalogId: mappingCatalog };
  const mappingResults = await Promise.allSettled([adminKitchenwareService.decideMapping(mappingId,mappingDecision,adminKitchenwareContext),adminKitchenwareService.decideMapping(mappingId,mappingDecision,adminKitchenwareContext)]);
  assert.equal(mappingResults.filter(item => item.status === "fulfilled").length,1,JSON.stringify(mappingResults.map(item => item.status === "rejected" ? String(item.reason) : item.status)));
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM recipe_kitchenware_requirements WHERE recipe_id=$1 AND catalog_id=$2",[mappingRecipe,mappingCatalog])).rows[0].n),1);
  assert((await pool.query("SELECT aliases FROM kitchenware_catalog WHERE id=$1",[mappingCatalog])).rows[0].aliases.includes(mappingRaw));
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM admin_audit_logs WHERE action='kitchenware_mapping.approved' AND resource_id=$1",[String(mappingId)])).rows[0].n),1);

  const kitchenwareRecipe = await pool.query(`INSERT INTO recipes
    (title, cook_time, steps_json, ingredients_json, source, status, quality_status, data_license,
     source_revision, serving_size, required_kitchenware_json)
    VALUES ('Postgres 厨具替代菜', 20, '["烹饪测试"]'::jsonb, '[{"name":"番茄"}]'::jsonb,
      'official', 'approved', 'trusted', 'DietDigiDose-Original', 'postgres-kitchenware-v1', 1, '["空气炸锅"]'::jsonb)
    RETURNING id`);
  const kitchenwareRecipeId = Number(kitchenwareRecipe.rows[0]!.id);
  const kitchenwareCatalogIds = await pool.query("SELECT id, name FROM kitchenware_catalog WHERE name IN ('空气炸锅', '烤箱')");
  const airFryerId = Number(kitchenwareCatalogIds.rows.find((row) => row.name === "空气炸锅")!.id);
  await pool.query(`INSERT INTO recipe_kitchenware_requirements
    (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
    VALUES ($1, $2, 'bake', 'required', 'test', 1, 'Postgres 空气炸锅测试')`, [kitchenwareRecipeId, airFryerId]);
  await kitchenwareService.create(user.id, {
    name: "烤箱", category: "小家电", status: "良好", note: "", image_url: "", purchase_date: "",
  });
  const postgresCompatibility = await kitchenwareService.compatibility(user.id, kitchenwareRecipeId);
  assert.equal(postgresCompatibility.blocking.length, 1);
  assert.equal(postgresCompatibility.requirements[0]?.substitution?.name, "烤箱");
  assert.equal(await kitchenwareRepository.removeItem(user.id + 1, Number(postgresPan.id)), false);
  assert.equal(await kitchenwareRepository.removeItem(user.id, Number(postgresPan.id)), true);

  const recommendationsRepository = new PostgresRecommendationsRepository(pool);
  const recommendationsService = new RecommendationsService(recommendationsRepository, kitchenwareService);
  const weeklyState = await recommendationsRepository.planningState(protectedUserId,replacementToday,replacementWeekEnd);
  assert(weeklyState.items.some(item => item.id === protectedItemId));
  assert.equal((await recommendationsRepository.planningState(-1,replacementToday,replacementWeekEnd)).items.length,0);
  const stockBeforeWeekly = await recommendationsRepository.inventory(protectedUserId);
  const weeklyPreview = await recommendationsService.weeklyPlan(protectedUserId,{ startDate: replacementToday,mealTypes: ["breakfast","lunch","dinner"] });
  assert.equal(weeklyPreview.slots.length,21);
  assert(weeklyPreview.slots.some(slot => slot.preservedItemIds.includes(protectedItemId)));
  assert.deepEqual(await recommendationsRepository.inventory(protectedUserId),stockBeforeWeekly);
  // Its last catalogue-dependent assertion is complete; do not affect unrelated recommendation ranking.
  await pool.query("UPDATE recipes SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1",[protectedRecipeId]);
  const recommendationPage = await recommendationsService.page(user.id, {
    surface: "home", matchStatus: "all", pageSize: 1,
  });
  assert(recommendationPage.total > 0);
  assert.equal(recommendationPage.items.length, 1);
  const recommendationSnapshot = await pool.query(`SELECT input_snapshot_json, results_json FROM recipe_recommendation_requests
    WHERE id = $1 AND user_id = $2`, [recommendationPage.requestId, user.id]);
  assert.equal(Array.isArray(recommendationSnapshot.rows[0]?.results_json), true);
  assert.equal(recommendationSnapshot.rows[0]?.input_snapshot_json.surface, "home");
  if (recommendationPage.nextCursor) {
    const nextRecommendationPage = await recommendationsService.page(user.id, {
      surface: "home", matchStatus: "all", pageSize: 1, cursor: recommendationPage.nextCursor,
    });
    assert.equal(nextRecommendationPage.requestId, recommendationPage.requestId);
  }
  const recommendedRecipeId = Number(recommendationPage.items[0]!.recipeId);
  const recommendationEventInput = {
    requestId: recommendationPage.requestId, recipeId: recommendedRecipeId, eventType: "view",
    scoringVersion: recommendationPage.scoringVersion, surface: "home", metadata: { source: "postgres-integration" },
    idempotencyKey: "postgres-recommendation-event-0001",
  };
  const recommendationEvents = await Promise.all([
    recommendationsService.event(user.id, recommendationEventInput),
    recommendationsService.event(user.id, recommendationEventInput),
  ]);
  assert.deepEqual(recommendationEvents.map((result) => result.repeated).sort(), [false, true]);
  const selectionEvent = await recommendationsRepository.findEvent(user.id, recommendationEventInput.idempotencyKey);
  assert.deepEqual((selectionEvent?.metadata_json as Record<string, unknown>).selectionEvidence, {
    version: 1, requestId: recommendationPage.requestId, recipeId: recommendedRecipeId,
    inventory: (recommendationPage.items[0]!.features as Record<string, unknown>).inventoryEvidence,
  });
  await assert.rejects(recommendationsService.event(user.id, { ...recommendationEventInput, eventType: "queue" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RECOMMENDATION_EVENT_CONFLICT");

  assert.equal(recommendationEvents[0]!.eventId, recommendationEvents[1]!.eventId);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM recipe_recommendation_events
    WHERE user_id = $1 AND idempotency_key = $2`, [user.id, recommendationEventInput.idempotencyKey])).rows[0]?.count), 1);

  const selectedQueue = await new CookingQueueService(cookingQueueRepository).create(user.id, {
    recipeId: recommendedRecipeId, recommendationRequestId: recommendationPage.requestId,
  });
  assert.equal(selectedQueue.added, true);
  const queuedSelection = (await pool.query("SELECT recipe_snapshot_json FROM cooking_queue_items WHERE id=$1",[selectedQueue.item.id])).rows[0].recipe_snapshot_json.selectionEvidence;
  assert.equal(queuedSelection.requestId, recommendationPage.requestId);
  const guardedStock = await inventoryService.create(user.id, { food_name: "PG执行审核保护原料", quantity: "100g", quantity_value: 100, quantity_unit: "g", category: "其他", expiration_date: "2099-01-01", storage_location: "常温" });
  const selectedProductionInput = { idempotency_key: "pg-selection-production-186", inventory_item_ids: [],
    inventory_consumptions: [{ item_id: guardedStock.id, version: 1, mode: "amount" as const, amount_value: 10, unit: "g" as const }],
    production: { food_name: "PG 选择来源", produced_servings: 1, eaten_servings: 0, meal_type: "午餐", nutrition_per_serving: {}, queue_item_id: selectedQueue.item.id, queue_version: selectedQueue.item.version } };
  await pool.query("UPDATE recipes SET automatic_inventory_write_allowed=false WHERE id=$1", [recommendedRecipeId]);
  await assert.rejects(() => dietService.completeCooking(user.id, selectedProductionInput),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "RECIPE_EXECUTION_NOT_ALLOWED");
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM prepared_meals WHERE queue_item_id=$1", [selectedQueue.item.id])).rows[0].n), 0);
  assert.deepEqual((await pool.query("SELECT quantity_value,version FROM inventory_items WHERE id=$1", [guardedStock.id])).rows[0], { quantity_value: 100, version: 1 });
  await pool.query("UPDATE recipes SET automatic_inventory_write_allowed=true WHERE id=$1", [recommendedRecipeId]);
  const selectedProduction = await dietService.completeCooking(user.id, selectedProductionInput);
  assert.equal((selectedProduction.prepared_meal as { recipe_id: number }).recipe_id, recommendedRecipeId);
  assert.deepEqual(selectedProduction.selection_evidence, queuedSelection);
  assert.equal(selectedProduction.diet_record, null);
  await pool.query("DELETE FROM cooking_queue_items WHERE id=$1",[selectedQueue.item.id]);
  assert.deepEqual((await dietService.completeCooking(user.id, selectedProductionInput)).selection_evidence, queuedSelection);

  const oldMetricEnvironment = process.env.CORE_LOOP_ENVIRONMENT;
  process.env.CORE_LOOP_ENVIRONMENT = "pg-metric-fixture";
  try {
    const settings = await adminConsoleService.coreLoopSettings();
    await adminConsoleService.configureCoreLoops({ enabled: true,version: settings.version },adminFoodContext);
    const classifications = await Promise.allSettled([
      adminConsoleService.classifyCoreLoopActor(user.id,{ kind: "real",version: 0 },adminFoodContext),
      adminConsoleService.classifyCoreLoopActor(user.id,{ kind: "real",version: 0 },adminFoodContext),
    ]);
    assert.equal(classifications.filter(item => item.status === "fulfilled").length,1);
    const metricStock = (await inventoryService.bulkIntake(user.id,{ idempotency_key: "pg-confirmed-scan-metric-186",source: "image",items: [{ food_name: "PG闭环鸡蛋",category: "蛋类",quantity: "2个",quantity_value: 2,quantity_unit: "piece",expiration_date: "2036-09-20",storage_location: "冷藏",source: "image",confirmed: true }] })).items[0];
    const metricRecipe = (await pool.query("INSERT INTO recipes(title,description,cook_time,difficulty,category,ingredients_json,steps_json,status,quality_status,serving_size) VALUES('PG闭环蒸蛋','验收',10,'简单','PG闭环验收',$1::jsonb,$2::jsonb,'approved','trusted',1) RETURNING id",[JSON.stringify([{ name: "PG闭环鸡蛋",amount: "1枚" }]),JSON.stringify(["蒸熟"])])).rows[0].id;
    const metricPage = await recommendationsService.page(user.id,{ surface: "inventory",category: "PG闭环验收",pageSize: 10 });
    assert.equal(metricPage.items[0].recipeId,metricRecipe);
    const metricQueue = await new CookingQueueService(cookingQueueRepository).create(user.id,{ recipeId: metricRecipe,recommendationRequestId: metricPage.requestId });
    const metricInput = { idempotency_key: "pg-core-loop-metric",recipe_id: metricRecipe,inventory_item_ids: [],inventory_consumptions: [{ item_id: metricStock.id,version: metricStock.version,mode: "amount" as const,amount_value: 1,unit: "piece" as const }],
      production: { food_name: "PG闭环制作",produced_servings: 1,eaten_servings: 1,meal_type: "午餐",nutrition_per_serving: {},queue_item_id: metricQueue.item.id,queue_version: metricQueue.item.version } };
    const oldFunnelWriter = dietRepository.recordFunnelEvent;
    dietRepository.recordFunnelEvent = async () => { throw new Error("injected analytics outage"); };
    let metricMade;
    try { metricMade = await dietService.completeCooking(user.id,metricInput); } finally { dietRepository.recordFunnelEvent = oldFunnelWriter; }
    const metricReport = await adminConsoleService.coreLoops({ details: "1" });
    assert.equal(metricReport.verifiedUsers,1,JSON.stringify(metricReport));
    assert.equal(metricReport.verifiedLoops,1);
    process.env.CORE_LOOP_ENVIRONMENT = "pg-other-fixture";
    assert.equal((await adminConsoleService.coreLoops({})).status,"not_collected");
    assert.equal((await adminConsoleService.coreLoopSettings()).enabled,false);
    process.env.CORE_LOOP_ENVIRONMENT = "pg-metric-fixture";

    await dietService.completeCooking(user.id,metricInput);
    assert.equal((await adminConsoleService.coreLoops({})).verifiedLoops,1);
    await adminConsoleService.classifyCoreLoopActor(user.id,{ kind: "automation",version: 1 },adminFoodContext);
    assert.equal((await adminConsoleService.coreLoops({})).verifiedLoops,0);
    await adminConsoleService.classifyCoreLoopActor(user.id,{ kind: "real",version: 2 },adminFoodContext);
    await dietService.remove(user.id,Number((metricMade.diet_record as Record<string,unknown>).id),"undo_eating");
    assert.equal((await adminConsoleService.coreLoops({})).verifiedLoops,0);
    assert(Number((await pool.query("SELECT COUNT(*) n FROM admin_audit_logs WHERE action='core_loop.classify' AND resource_id=$1",[String(user.id)])).rows[0].n)>=3);
  } finally {
    if (oldMetricEnvironment === undefined) delete process.env.CORE_LOOP_ENVIRONMENT; else process.env.CORE_LOOP_ENVIRONMENT = oldMetricEnvironment;
  }

  for (const reason of ["no_time","too_much","dislike"]) {
    for (let index=0;index<3;index++) await recommendationsService.event(user.id,{ ...recommendationEventInput,eventType: "skip",metadata: { reason,scope: "long_term" },idempotencyKey: `preference-${reason}-${index}` });
    assert.deepEqual(await recommendationsRepository.skippedRecipeIds(user.id),reason === "dislike" ? [recommendedRecipeId] : []);
  }
  assert.deepEqual(await recommendationsRepository.skippedRecipeIds(-1),[]);
  await pool.query("UPDATE recipe_recommendation_events SET metadata_json=metadata_json || '{\"withdrawn\":true}'::jsonb WHERE user_id=$1 AND idempotency_key='preference-dislike-0'",[user.id]);
  assert.deepEqual(await recommendationsRepository.skippedRecipeIds(user.id),[]);

  const learningUpdates = await Promise.all([recommendationsRepository.updateLearning(user.id,{ kind: "learning",version: 1,enabled: false }),recommendationsRepository.updateLearning(user.id,{ kind: "learning",version: 1,enabled: false })]);
  assert.deepEqual(learningUpdates.sort(),[false,true]);
  for (let index=0;index<3;index++) await recommendationsService.event(user.id,{ ...recommendationEventInput,eventType: "skip",metadata: { reason: "dislike",scope: "long_term" },idempotencyKey: `learning-paused-${index}` });
  assert.equal((await recommendationsService.learningState(user.id)).enabled,false);
  assert.equal(await recommendationsRepository.updateLearning(user.id,{ kind: "recipe",version: 2,recipeId: recommendedRecipeId,value: "neutral" }),true);
  await recommendationsRepository.updateLearning(user.id,{ kind: "learning",version: 3,enabled: true });
  assert.equal((await recommendationsService.learningState(user.id)).items.length,0);
  assert.equal((await pool.query("SELECT metadata_json->>'learningPaused' paused FROM recipe_recommendation_events WHERE user_id=$1 AND idempotency_key='learning-paused-0'",[user.id])).rows[0].paused,"true");
  assert.equal((await recommendationsService.learningState(householdMember)).version,1);

  const timeMeal = (await pool.query("SELECT version,remaining_servings FROM prepared_meals WHERE id=$1",[prepared.id])).rows[0];
  const timeCorrection = { idempotency_key: "pg-time-correction-197",version: Number(timeMeal.version),type: "reschedule" as const,reported_cooking_minutes: 18 };
  const timeCorrections = await Promise.all([dietService.applyMealEvent(user.id,prepared.id,timeCorrection),dietService.applyMealEvent(user.id,prepared.id,timeCorrection)]);
  assert.deepEqual(timeCorrections.map(result => result.repeated).sort(),[false,true]);
  assert.equal((timeCorrections[0].prepared_meal as { reported_cooking_minutes: number }).reported_cooking_minutes,18);
  const timeCleared = await dietService.applyMealEvent(user.id,prepared.id,{ ...timeCorrection,idempotency_key: "pg-time-clear-197",version: Number(timeMeal.version)+1,reported_cooking_minutes: null });
  assert.equal((timeCleared.prepared_meal as { reported_cooking_minutes: number | null }).reported_cooking_minutes,null);
  assert.equal(Number((await pool.query("SELECT remaining_servings FROM prepared_meals WHERE id=$1",[prepared.id])).rows[0].remaining_servings),Number(timeMeal.remaining_servings));
  await pool.query("INSERT INTO user_health_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[user.id]);
  const previousKitchen = (await pool.query("SELECT kitchen_constraints_json FROM user_health_profiles WHERE user_id=$1",[user.id])).rows[0].kitchen_constraints_json;
  await pool.query("UPDATE user_health_profiles SET kitchen_constraints_json=kitchen_constraints_json || '{\"servings\":2}'::jsonb WHERE user_id=$1",[user.id]);
  const dialogueEvidenceRunId = "postgres-dialogue-evidence-run";
  await pool.query("INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id) VALUES($1,$2,$1,'text','assistant','running','{}',$1)",[dialogueEvidenceRunId,user.id]);
  await pool.query("INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,before_json,result_json,idempotency_key,executed_at) VALUES('dialogue-evidence-action',$1,$2,'update_kitchen_preferences','high','executed','{}','{\"servings\":1}','{\"scope\":\"persistent\",\"kitchenPreferences\":{\"servings\":2}}','dialogue-evidence-action',CURRENT_TIMESTAMP)",[dialogueEvidenceRunId,user.id]);
  assert((await recommendationsService.learningState(user.id)).observations.some(fact => fact.id === "preference-statement:dialogue-evidence-action" && fact.valid));
  await pool.query("UPDATE user_health_profiles SET kitchen_constraints_json=kitchen_constraints_json || '{\"servings\":3}'::jsonb WHERE user_id=$1",[user.id]);
  assert((await recommendationsService.learningState(user.id)).observations.some(fact => fact.id === "preference-statement:dialogue-evidence-action" && !fact.valid));
  await pool.query("UPDATE user_health_profiles SET kitchen_constraints_json=$1::jsonb WHERE user_id=$2",[JSON.stringify(previousKitchen),user.id]);
  const outcomeFacts = (await recommendationsService.learningState(user.id)).observations;
  assert(outcomeFacts.some(fact => fact.kind === "production"));
  const remainingFacts = (await pool.query("SELECT id,remaining_servings FROM prepared_meals WHERE user_id=$1",[user.id])).rows;
  for (const fact of outcomeFacts.filter(fact => fact.kind === "production")) {
    assert.equal(fact.remainingServings,Number(remainingFacts.find(row => `production:${row.id}`===fact.id)?.remaining_servings));
    assert.ok(fact.observedAt);
  }
  assert(outcomeFacts.some(fact => fact.kind === "inventory" && fact.valid));
  assert(outcomeFacts.some(fact => fact.kind === "inventory" && !fact.valid));
  const protectedOutcomes = (await recommendationsService.learningState(protectedUserId)).observations;
  assert(protectedOutcomes.some(fact => fact.kind === "plan_change" && !fact.valid));
  assert(outcomeFacts.some(fact => fact.correctionId && !fact.valid));
  assert.equal(new Set(outcomeFacts.map(fact => fact.id)).size,outcomeFacts.length);
  assert.deepEqual(await recommendationsRepository.preferenceOutcomes(-1),{ production: [],events: [],inventory: [],changes: [],statements: [] });
  const { verifyAgentRecipePreference } = await import("./agentRecipePreferenceAssertions.js");
  await verifyAgentRecipePreference(new PostgresAgentOperationsRepository(pool),recommendationsService,
    async (sql,values) => { let position = 0; return pool.query(sql.replace(/\?/g,() => `$${++position}`),values); },user.id,recommendedRecipeId);


  const aiToolDataService = new AiToolDataService(new PostgresAiToolDataRepository(pool));
  await pool.query(`INSERT INTO recipes
    (title, cook_time, difficulty, calories, protein, carbs, fat, tags, ingredients_json, source, status, quality_status)
    VALUES ('Postgres AI 工具菜', 14, '简单', 280, 19, 24, 9, '["AI工具"]'::jsonb,
      '[{"name":"PG专用番茄"}]'::jsonb, 'official', 'approved', 'trusted')`);
  const aiRecipes = await aiToolDataService.searchRecipes({ ingredientNames: ["PG专用番茄"], maxTimeMinutes: 15,
    maxCalories: 300, minProteinG: 18, limit: 2 });
  assert.equal(aiRecipes.recipes.length, 1);
  assert.equal(aiRecipes.recipes[0]?.name, "Postgres AI 工具菜");
  assert.deepEqual(aiRecipes.recipes[0]?.tags, ["AI工具"]);
  await pool.query(`INSERT INTO ingredients_library
    (name, category, calories_100g, protein_100g, carbs_100g, fat_100g, source, quality_status)
    VALUES ('PG专用燕麦', '主食', 380, 13.2, 67.5, 6.5, 'postgres-integration', 'trusted')`);
  const aiNutrition = await aiToolDataService.lookupFoodNutrition("PG专用燕麦", 50, "g");
  assert.deepEqual(aiNutrition.matches[0]?.nutrition,
    { caloriesKcal: 190, proteinG: 6.6, carbohydrateG: 33.8, fatG: 3.3 });
  const aiDietId = await aiToolDataService.recordDietMeal({ userId: user.id, mealType: "午餐", foodName: "Postgres AI 工具餐",
    amount: "1份", calories: 280, protein: 19, carbs: 24, fat: 9, recordedAt: "2026-09-01", recordedTime: "12:30" });
  assert.equal((await pool.query("SELECT food_name FROM diet_records WHERE id = $1", [aiDietId])).rows[0]?.food_name,
    "Postgres AI 工具餐");

  await pool.query(`INSERT INTO system_settings (key, value) VALUES ('AI_SYSTEM_PROMPT', 'Postgres 食语人设')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`);
  await pool.query(`INSERT INTO user_health_profiles
    (user_id, age, dietary_preference, allergies_json, medical_conditions_json, dietary_restrictions_json,
      kitchen_constraints_json, nutrition_targets_json)
    VALUES ($1, 31, '清淡', '[{"name":"花生","type":"过敏","severity":"重度"}]'::jsonb, '["孕期"]'::jsonb,
      '["低盐"]'::jsonb, '{"meal_time_minutes":20}'::jsonb, '{"protein_g":90}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET age = EXCLUDED.age, dietary_preference = EXCLUDED.dietary_preference,
      allergies_json = EXCLUDED.allergies_json, medical_conditions_json = EXCLUDED.medical_conditions_json,
      dietary_restrictions_json = EXCLUDED.dietary_restrictions_json,
      kitchen_constraints_json = EXCLUDED.kitchen_constraints_json, nutrition_targets_json = EXCLUDED.nutrition_targets_json`, [user.id]);
  const aiContextService = new AiContextService(new PostgresAiContextRepository(pool));
  const aiContext = await aiContextService.load(user.id, "2026-09-01");
  assert.equal(aiContext.personaPrompt, "Postgres 食语人设");
  assert(aiContext.inventory.some((item) => item.food_name === "番茄"));
  assert(aiContext.kitchenware.some((item) => item.name === "烤箱"));
  assert(aiContext.todayDiet.some((item) => item.food_name === "Postgres AI 工具餐"));
  assert.equal(aiContext.latestHealth?.weight, 62.5);
  assert.deepEqual(aiContext.healthProfile?.allergies, [{ name: "花生", type: "过敏", severity: "重度" }]);
  assert.deepEqual(aiContext.healthProfile?.medical_conditions, ["孕期"]);
  assert.equal(aiContext.healthProfile?.kitchen_constraints.meal_time_minutes, 20);

  const aiRuntimeService = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), {
    AI_INPUT_COST_PER_MILLION_USD: "2", AI_OUTPUT_COST_PER_MILLION_USD: "4",
  });
  await aiRuntimeService.saveSettings([
    { key: "AI_API_KEY", value: "postgres-global-key" },
    { key: "AI_BASE_URL", value: "https://postgres-ai.test/v1/" },
    { key: "AI_CHAT_MODEL", value: "postgres-chat-model" },
    { key: "AI_RECIPE_MODEL", value: "postgres-recipe-model" },
  ]);
  const postgresAIConfig = await aiRuntimeService.config();
  assert.deepEqual(postgresAIConfig.chat,
    { apiKey: "postgres-global-key", baseUrl: "https://postgres-ai.test/v1", model: "postgres-chat-model" });
  assert.equal((await aiRuntimeService.agentConfig("RECIPE")).model, "postgres-recipe-model");
  await aiRuntimeService.recordUsage({ userId: user.id, endpoint: "postgres-ai-runtime", model: "postgres-chat-model",
    runId: "postgres-ai-runtime-run", agentName: "Recipe", phase: "integration", promptTokens: 1_000,
    completionTokens: 500, latencyMs: 33, success: false, failureReason: "integration failure" });
  const postgresAIUsage = (await pool.query(`SELECT total_tokens, success, estimated_cost_usd, failure_reason
    FROM ai_usage_logs WHERE user_id = $1 AND endpoint = 'postgres-ai-runtime'`, [user.id])).rows[0];
  assert.equal(Number(postgresAIUsage?.total_tokens), 1_500);
  assert.equal(postgresAIUsage?.success, false);
  assert.equal(Number(postgresAIUsage?.estimated_cost_usd), 0.004);
  assert.equal(postgresAIUsage?.failure_reason, "integration failure");

  const authVerificationService = new AuthVerificationService(new PostgresAuthVerificationRepository(pool));
  await authVerificationService.saveSettings([
    { key: "auth.sms.enabled", value: "1" },
    { key: "auth.sms.limit.phone_hour", value: "8" },
  ]);
  const postgresSmsConfig = await authVerificationService.config();
  assert.equal(postgresSmsConfig.enabled, true);
  assert.equal(postgresSmsConfig.phoneHourlyLimit, 8);
  const verificationSubject = await authVerificationService.findOrCreateSubject("18800001149");
  const sameVerificationSubject = await authVerificationService.findOrCreateSubject("18800001149");
  assert.equal(sameVerificationSubject.id, verificationSubject.id);
  assert.equal(authVerificationService.decryptPhone(verificationSubject), "18800001149");
  await authVerificationService.createChallenge({ id: "postgres-verification-send", subjectId: verificationSubject.id,
    purpose: "login", outId: "postgres-verification-out", expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sourceIp: "192.0.2.153", userAgent: "postgres-integration" });
  await authVerificationService.recordEvent({ subjectId: verificationSubject.id, challengeId: "postgres-verification-send",
    eventType: "send_api_called", outcome: "pending", sourceIp: "192.0.2.153", details: { postgres: true } });
  await authVerificationService.incrementUsage("send_api_calls");
  assert.equal(await authVerificationService.countSubjectSends(verificationSubject.id,
    new Date(Date.now() - 60_000).toISOString()), 1);
  assert.equal(await authVerificationService.countIpSends("192.0.2.153", new Date(Date.now() - 60_000).toISOString()), 1);
  await authVerificationService.acceptChallenge("postgres-verification-send", verificationSubject.id, "postgres-biz-153", "request-153");
  assert.equal((await authVerificationService.challenge("postgres-verification-send"))?.status, "accepted");
  assert.equal(await authVerificationService.recordDeliveryReport({ bizId: "postgres-biz-153", outId: "postgres-verification-out",
    providerCode: "OK", providerMessage: "delivered to 18800001149", success: true, units: 2, usageDate: "2026-09-01",
    details: { postgres: true, smsSize: 2 } }), true);
  assert.equal(await authVerificationService.recordDeliveryReport({ bizId: "postgres-biz-153", outId: "postgres-verification-out",
    providerCode: "OK", providerMessage: "delivered to 18800001149", success: true, units: 2, usageDate: "2026-09-01",
    details: { postgres: true, smsSize: 2 } }), false);
  const postgresVerificationOverview = await authVerificationService.usageOverview("2026-09-01");
  assert.equal(postgresVerificationOverview.totals.delivered, 1);
  assert.equal(postgresVerificationOverview.totals.deliveryUnits, 2);
  const postgresDeliveryEvent = (await authVerificationService.events({ providerId: "postgres-biz-153" }, 1, 20)).rows[0];
  assert.equal(postgresDeliveryEvent?.providerMessage, "delivered to [phone]");
  assert.deepEqual((await pool.query(`SELECT details_json FROM auth_verification_events
    WHERE challenge_id='postgres-verification-send' AND event_type='delivery_report'`)).rows[0]?.details_json,
  { postgres: true, smsSize: 2 });

  const registrationSubject = await authVerificationService.findOrCreateSubject("18800002149");
  await authVerificationService.createChallenge({ id: "postgres-verification-register", subjectId: registrationSubject.id,
    purpose: "login", outId: "postgres-registration-out", expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sourceIp: "192.0.2.154", userAgent: "postgres-integration" });
  await authVerificationService.markRegistrationRequired({ challengeId: "postgres-verification-register",
    at: new Date().toISOString(), tokenHash: "postgres-registration-token-hash",
    expiresAt: new Date(Date.now() + 300_000).toISOString() });
  const postgresRegistration = await authVerificationService.register({ tokenHash: "postgres-registration-token-hash",
    phone: "18800002149", username: "postgres短信用户", passwordHash: "integration-password-hash", at: new Date().toISOString() });
  assert.equal(postgresRegistration.status, "created");
  if (postgresRegistration.status === "created") {
    assert.equal((await authVerificationService.userResponse(postgresRegistration.userId))?.phone, "18800002149");
    assert.equal((await authVerificationService.userByPhone("18800002149"))?.is_disabled, false);
    assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM user_health_profiles WHERE user_id=$1",
      [postgresRegistration.userId])).rows[0]?.count), 1);
  }
  assert.equal((await authVerificationService.register({ tokenHash: "postgres-registration-token-hash", phone: "18800002149",
    username: "postgres短信重复用户", passwordHash: "hash", at: new Date().toISOString() })).status, "invalid_token");

  if (postgresRegistration.status === "created") {
    const notificationUserId = postgresRegistration.userId;
    const notificationsRepository = new PostgresNotificationsRepository(pool);
    const { verifyInterventionReservation } = await import("./interventionReservationAssertions.js");
    await verifyInterventionReservation(notificationsRepository,notificationUserId);
    assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM user_notification_inbox WHERE user_id=$1 AND type='proactive_intervention'",[notificationUserId])).rows[0].n),2);
    const { verifyInterventionDelivery } = await import("./interventionReservationAssertions.js");
    await verifyInterventionDelivery(notificationsRepository,notificationUserId);
    const { verifyInterventionScanCursor } = await import("./interventionReservationAssertions.js");
    await verifyInterventionScanCursor(notificationsRepository,new PostgresWorkerRepository(pool));
    const { verifyInterventionFeedback } = await import("./interventionReservationAssertions.js");
    await verifyInterventionFeedback(notificationsRepository,notificationUserId);
    const { verifyInterventionOutcomes } = await import("./interventionOutcomeAssertions.js");
    const outcomeUser = (await pool.query("INSERT INTO users(username,email,password_hash) VALUES('干预归因测试','intervention-outcome@example.invalid','isolated-test-hash') RETURNING id")).rows[0];
    await verifyInterventionOutcomes(notificationsRepository,new PostgresInsightsRepository(pool),Number(outcomeUser.id),async (sql,values) => {
      let index = 0; const rows = (await pool.query(sql.replace(/\?/g,() => `$${++index}`),values)).rows;
      return rows.map(row => ({ ...row, ...(row.n !== undefined ? { n: Number(row.n) } : {}) }));
    }, async enabled => {
      if (enabled) await pool.query(`CREATE FUNCTION fail_intervention_outcome() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'attribution failure'; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_intervention_outcome BEFORE INSERT ON proactive_intervention_outcomes FOR EACH ROW EXECUTE FUNCTION fail_intervention_outcome()`);
      else await pool.query("DROP TRIGGER fail_intervention_outcome ON proactive_intervention_outcomes; DROP FUNCTION fail_intervention_outcome()");
    });

    const { verifyInterventionQueue } = await import("./interventionQueueAssertions.js");
    await verifyInterventionQueue(notificationsRepository,new PostgresCookingQueueRepository(pool),async (sql,values) => {
      let index = 0; return (await pool.query(sql.replace(/\?/g,() => `$${++index}`),values)).rows.map(row => ({ ...row, ...(row.n !== undefined ? { n: Number(row.n) } : {}) }));
    },async enabled => {
      if (enabled) await pool.query(`CREATE FUNCTION fail_intervention_start() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'attribution failure'; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_intervention_start BEFORE INSERT ON proactive_intervention_outcomes FOR EACH ROW EXECUTE FUNCTION fail_intervention_start()`);
      else await pool.query("DROP TRIGGER fail_intervention_start ON proactive_intervention_outcomes; DROP FUNCTION fail_intervention_start()");
    });

    const { defaultInterventionPreferences } = await import("@dietdigidose/contracts");
    const currentInterventionPreferences = await notificationsRepository.interventionPreferences(user.id);
    const preferenceInput = { ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,version: Number(currentInterventionPreferences?.version ?? 0) };
    const concurrentPreferenceChanges = await Promise.all([
      notificationsRepository.saveInterventionPreferences(user.id,preferenceInput),
      notificationsRepository.saveInterventionPreferences(user.id,preferenceInput),
    ]);
    assert.equal(concurrentPreferenceChanges.filter(Boolean).length,1);
    await pool.query("UPDATE proactive_interventions SET delivery_state='pending' WHERE id='pg-intervention'");
    assert(await notificationsRepository.saveInterventionPreferences(user.id,{ ...preferenceInput,enabled: false,version: preferenceInput.version+1 }));
    assert.equal((await pool.query("SELECT delivery_state FROM proactive_interventions WHERE id='pg-intervention'")).rows[0].delivery_state,'cancelled');

    const notificationsService = createNotificationsService(notificationsRepository);
    const preferences = { ...await notificationsService.preferences(notificationUserId), breakfast_time: "07:30", expiring_alert: true };
    await notificationsService.savePreferences(notificationUserId, preferences);
    assert.equal((await notificationsService.preferences(notificationUserId)).breakfast_time, "07:30");
    await notificationsService.saveDevice(notificationUserId, "ExpoPushToken[postgres-notifications]", "ios");
    await notificationsRepository.ensureRoutineNotification({ userId: notificationUserId, kind: "meal", key: "breakfast",
      dateKey: "2026-09-01", title: "Postgres 早餐", body: "Postgres 例行提醒" });
    await notificationsRepository.ensureRoutineNotification({ userId: notificationUserId, kind: "meal", key: "breakfast",
      dateKey: "2026-09-01", title: "Postgres 早餐", body: "Postgres 例行提醒" });
    assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM user_notification_inbox
      WHERE user_id=$1 AND group_key='routine:meal:breakfast:2026-09-01'`, [notificationUserId])).rows[0].count), 1);
    await pool.query(`INSERT INTO inventory_items(user_id,food_name,category,quantity,expiration_date,quantity_value,quantity_unit,is_available)
      VALUES($1,'Postgres 临期苹果','水果','1个','2026-09-02',1,'个',TRUE)`, [notificationUserId]);
    const prepared = await notificationsRepository.prepareExpiring("2026-09-01", "2026-09-04");
    const preparedNotification = prepared.find((item) => item.userId === notificationUserId);
    assert(preparedNotification);
    assert.equal((await notificationsRepository.prepareExpiring("2026-09-01", "2026-09-04")).length, 0);
    const pendingHistory = await notificationsRepository.history(notificationUserId, "pending", null, 10);
    assert(pendingHistory.some((item) => Number(item.id) === preparedNotification.notificationId));
    const expiryNotificationId = preparedNotification.notificationId;
    assert.equal(await notificationsRepository.action(notificationUserId, expiryNotificationId, "complete", { postgres: true }), true);
    assert.equal((await pool.query("SELECT is_available FROM inventory_items WHERE food_name='Postgres 临期苹果'")).rows[0].is_available, true);
    assert.equal(await notificationsRepository.action(notificationUserId, expiryNotificationId, "complete"), true);
    assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM notification_events WHERE notification_id=$1 AND event_type='action_complete'",[expiryNotificationId])).rows[0].n),1);
    const campaign = await notificationsRepository.beginCampaign(user.id, "Postgres 活动", "Postgres 活动正文");
    assert(campaign.devices.some((device) => device.userId === notificationUserId));
    await notificationsRepository.recordPushTickets([{ message: { to: "ExpoPushToken[postgres-notifications]", title: "Postgres 活动",
      body: "Postgres 活动正文", data: { type: "admin_campaign", campaignId: campaign.campaignId } },
    ticket: { id: "postgres-notification-ticket", status: "ok" } }]);
    const pendingReceipt = (await notificationsRepository.pendingReceipts(new Date(Date.now() + 60_000).toISOString(), 10))
      .find((item) => item.ticketId === "postgres-notification-ticket")!;
    assert.equal(pendingReceipt.userId, notificationUserId);
    await notificationsRepository.applyReceipts([{ ...pendingReceipt,
      receipt: { status: "error", details: { error: "DeviceNotRegistered" }, message: "gone" } }]);
    await notificationsRepository.finishCampaign(campaign.campaignId,
      campaign.devices.map((device) => ({ deviceId: device.id, userId: device.userId, status: "accepted" as const, errorCode: null })), 1, 0);
    assert.equal((await pool.query("SELECT is_active FROM push_devices WHERE expo_push_token='ExpoPushToken[postgres-notifications]'"))
      .rows[0].is_active, false);
    const notificationAdmin = await notificationsService.adminData();
    assert(notificationAdmin.metrics.pushSubmitted >= 1);
    assert(notificationAdmin.metrics.pushFailures >= 1);
  }

  const adminAuditService = new AdminAuditService(new PostgresAdminAuditRepository(pool));
  await adminAuditService.record({ adminUserId: user.id, action: "postgres.audit.verify", resourceType: "integration",
    resourceId: 149, summary: "验证 PostgreSQL 管理员审计", details: { jsonb: true },
    ipAddress: "192.0.2.149", userAgent: "postgres-integration" });
  const postgresAudit = await pool.query(`SELECT resource_id, details_json, ip_address FROM admin_audit_logs
    WHERE admin_user_id = $1 AND action = 'postgres.audit.verify'`, [user.id]);
  assert.equal(postgresAudit.rows[0]?.resource_id, "149");
  assert.deepEqual(postgresAudit.rows[0]?.details_json, { jsonb: true });
  assert.equal(postgresAudit.rows[0]?.ip_address, "192.0.2.149");

  const recipesRepository = new PostgresRecipesRepository(pool);
  const recipesService = new RecipesService(recipesRepository, kitchenwareService);
  const postgresRecipePage = await recipesService.list(user.id, {
    search: "Postgres 厨具替代菜", pageSize: "1",
  }, { protocol: "https", host: "api.integration.test" });
  const postgresRecipeBody = postgresRecipePage.body as { items: Array<Record<string, unknown>>; total: number };
  assert.equal(postgresRecipeBody.items[0]?.title, "Postgres 厨具替代菜");
  assert.equal(Array.isArray(postgresRecipeBody.items[0]?.ingredients), true);
  assert.equal(postgresRecipeBody.total, 1);

  const submissionBody = {
    title: "Postgres 用户投稿事务菜", description: "验证 PostgreSQL 投稿事务", image_url: "", cook_time: 18,
    difficulty: "简单", calories: 180, protein: 9, carbs: 20, fat: 6, category: "晚餐", tags: ["postgres"],
    steps: ["使用空气炸锅制作"], ingredients: [{ name: "番茄", amount: "2个" }],
    required_kitchenware: ["空气炸锅", "Postgres 未知锅"], optional_kitchenware: [], serving_size: 2,
  };
  const createdSubmission = await recipesService.createSubmission(user.id, submissionBody);
  const submissionId = createdSubmission.id;
  assert.equal(await recipesRepository.findPublic(submissionId), null);
  assert.equal((await recipesRepository.listMine(user.id)).some((recipe) => Number(recipe.id) === submissionId), true);
  assert.equal(await recipesRepository.findSubmission(user.id + 1, submissionId), null);
  const storedSubmission = await pool.query(`SELECT tags, ingredients_json, status, prep_time FROM recipes WHERE id = $1`, [submissionId]);
  assert.deepEqual(storedSubmission.rows[0]?.tags, ["postgres"]);
  assert.equal(storedSubmission.rows[0]?.ingredients_json[0]?.name, "番茄");
  assert.equal(storedSubmission.rows[0]?.status, "pending");
  assert.equal(storedSubmission.rows[0]?.prep_time, null);
  const storedRequirements = await pool.query(`SELECT c.name, r.role FROM recipe_kitchenware_requirements r
    JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id = $1 ORDER BY c.name`, [submissionId]);
  assert.deepEqual(storedRequirements.rows, [{ name: "空气炸锅", role: "required" }]);
  const storedReview = await pool.query(`SELECT raw_name, status FROM kitchenware_mapping_reviews
    WHERE source_type = 'recipe' AND source_id = $1`, [String(submissionId)]);
  assert.deepEqual(storedReview.rows, [{ raw_name: "Postgres 未知锅", status: "pending" }]);
  await assert.rejects(() => recipesService.updateSubmission(user.id + 1, submissionId, submissionBody), /未找到该投稿/);
  await recipesService.updateSubmission(user.id, submissionId, {
    ...submissionBody, prep_time: 0, title: "Postgres 用户投稿已更新", required_kitchenware: ["烤箱"],
  });
  const updatedRequirements = await pool.query(`SELECT c.name FROM recipe_kitchenware_requirements r
    JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id = $1`, [submissionId]);
  assert.deepEqual(updatedRequirements.rows, [{ name: "烤箱" }]);
  assert.equal((await pool.query("SELECT prep_time FROM recipes WHERE id=$1", [submissionId])).rows[0].prep_time, 0);
  await recipesService.updateSubmission(user.id, submissionId, { ...submissionBody, prep_time: "" });
  assert.equal((await pool.query("SELECT prep_time FROM recipes WHERE id=$1", [submissionId])).rows[0].prep_time, null);

  await pool.query("DELETE FROM recipe_favorites WHERE user_id = $1 AND recipe_id = $2", [user.id, kitchenwareRecipeId]);
  const favoriteWrites = await Promise.all([
    recipesRepository.addFavorite(user.id, kitchenwareRecipeId), recipesRepository.addFavorite(user.id, kitchenwareRecipeId),
  ]);
  assert.deepEqual(favoriteWrites, [true, true]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM recipe_favorites
    WHERE user_id = $1 AND recipe_id = $2`, [user.id, kitchenwareRecipeId])).rows[0]?.count), 1);
  assert.equal(await recipesRepository.withdrawSubmission(user.id + 1, submissionId), false);
  assert.equal(await recipesRepository.withdrawSubmission(user.id, submissionId), true);

  const failedSubmissionTitle = "Postgres 必须回滚的投稿";
  await assert.rejects(() => recipesRepository.createSubmission({
    authorUserId: user.id, canonicalKey: "postgresrollback", sourceContentHash: "f".repeat(64),
    recipe: {
      title: failedSubmissionTitle, description: "", imageUrl: "", cookTime: 10, difficulty: "简单", calories: 100,
      protein: 5, carbs: 10, fat: 3, nutrition: [], category: "其他", tags: [], steps: ["烹饪"],
      ingredients: [{ name: "番茄", amount: "1个", group: "主料" }], servingSize: 1, prepTime: 0,
      cuisine: null, mealTypes: [], requiredKitchenware: ["无效厨具"], optionalKitchenware: [],
    },
    requirements: [{ rawName: "无效厨具", normalizedName: "无效厨具", role: "required",
      catalogId: 2_147_483_647, confidence: 1 }],
  }));
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM recipes WHERE title = $1", [failedSubmissionTitle])).rows[0]?.count), 0);

  const adminRecipesRepository = new PostgresAdminRecipesRepository(pool);
  const adminRecipesService = new AdminRecipesService(adminRecipesRepository, kitchenwareService);
  const adminRecipeBody = {
    title: "Postgres 管理员事务菜", description: "验证管理员菜谱 PostgreSQL 事务", image_url: "", cook_time: 22,
    difficulty: "简单", calories: 220, protein: 10, carbs: 24, fat: 7, category: "晚餐", tags: ["postgres-admin"],
    steps: ["番茄切块", "放入空气炸锅烤熟"], ingredients: [{ name: "番茄", amount: "2个" }],
    required_kitchenware: ["空气炸锅", "Postgres 管理员未知锅"], optional_kitchenware: [], serving_size: 2,
  };
  const adminContext = { adminUserId: user.id, ipAddress: "127.0.0.1", userAgent: "postgres-integration" };
  const firstAdminRecipe = await adminRecipesService.create(user.id, adminRecipeBody, adminContext);
  const secondAdminRecipe = await adminRecipesService.create(user.id, { ...adminRecipeBody, description: "重复检测样本" }, adminContext);
  const adminList = await adminRecipesService.list({ search: "Postgres 管理员事务菜", pageSize: 10 });
  assert.equal((adminList as { total: number }).total, 2);
  const adminStored = await pool.query(`SELECT tags, steps_json, status, quality_status, prep_time FROM recipes WHERE id=$1`, [firstAdminRecipe.id]);
  assert.deepEqual(adminStored.rows[0]?.tags, ["postgres-admin"]);
  assert.equal(adminStored.rows[0]?.steps_json.length, 2);
  assert.equal(adminStored.rows[0]?.status, "approved");
  assert.equal(adminStored.rows[0]?.quality_status, "trusted");
  assert.equal(adminStored.rows[0]?.prep_time, null);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM recipe_duplicate_candidates
    WHERE recipe_id=$1 AND candidate_recipe_id=$2`, [Math.min(firstAdminRecipe.id, secondAdminRecipe.id), Math.max(firstAdminRecipe.id, secondAdminRecipe.id)])).rows[0]?.count), 1);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM kitchenware_mapping_reviews
    WHERE source_type='recipe' AND source_id=$1 AND raw_name='Postgres 管理员未知锅'`, [String(firstAdminRecipe.id)])).rows[0]?.count), 1);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE action='recipe.create' AND resource_id=$1`, [String(firstAdminRecipe.id)])).rows[0]?.count), 1);

  const beforeFailedMapping = (await pool.query("SELECT required_kitchenware_json FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0]?.required_kitchenware_json;
  await assert.rejects(() => adminRecipesRepository.replaceKitchenware(firstAdminRecipe.id, ["无效 FK 锅"], [], [{
    rawName: "无效 FK 锅", normalizedName: "无效fk锅", catalogId: 2_147_483_647, capabilityCode: null,
    role: "required", confidence: 1,
  }], { ...adminContext, action: "recipe.kitchenware_update", resourceId: firstAdminRecipe.id, summary: "必须回滚" }));
  assert.deepEqual((await pool.query("SELECT required_kitchenware_json FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0]?.required_kitchenware_json, beforeFailedMapping);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE action='recipe.kitchenware_update' AND resource_id=$1 AND summary='必须回滚'`, [String(firstAdminRecipe.id)])).rows[0]?.count), 0);
  await adminRecipesService.update(user.id, firstAdminRecipe.id, { ...adminRecipeBody, prep_time: "0" }, adminContext);
  assert.equal((await pool.query("SELECT prep_time FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0].prep_time, 0);
  await adminRecipesService.update(user.id, firstAdminRecipe.id, { ...adminRecipeBody, prep_time: null }, adminContext);
  assert.equal((await pool.query("SELECT prep_time FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0].prep_time, null);
  const adminCoverage = await adminRecipesService.coverage();
  const { verifyAdminRecipeMetadata } = await import("./helpers/adminRecipeMetadata.js");
  await verifyAdminRecipeMetadata(adminRecipesService, user.id, async (sql, values = []) => {
    let index = 0;
    return (await pool.query(sql.replace(/\?/g, () => `$${++index}`), values)).rows;
  }, adminRecipesRepository);
  assert(adminCoverage.byCategory.some((row) => row.value === "晚餐"));
  await adminRecipesService.reviewQuality(user.id, firstAdminRecipe.id, "needs_review", "PostgreSQL 集成复核", adminContext);
  assert.equal((await pool.query("SELECT quality_status FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0]?.quality_status, "needs_review");
  await adminRecipesService.remove(user.id, secondAdminRecipe.id, adminContext);
  assert((await pool.query("SELECT deleted_at FROM recipes WHERE id=$1", [secondAdminRecipe.id])).rows[0]?.deleted_at);

  const healthRepository = new PostgresHealthRepository(pool);
  const healthUpserts = await Promise.all([
    healthRepository.upsertLog(user.id, "2026-09-02", { weight: 63.2 }),
    healthRepository.upsertLog(user.id, "2026-09-02", { water_ml: 1800, cycle_status: null }),
  ]);
  assert.deepEqual(healthUpserts.map((result) => result.created).sort(), [false, true]);
  const postgresHealthLogs = await healthRepository.listLogs(user.id, 30);
  const mergedHealthLog = postgresHealthLogs.filter((log) => log.recorded_date === "2026-09-02");
  assert.equal(mergedHealthLog.length, 1);
  assert.equal(mergedHealthLog[0]?.weight, 63.2);
  assert.equal(mergedHealthLog[0]?.water_ml, 1800);
  const postgresHealthProfile = await healthRepository.upsertProfile(user.id, {
    allergies_json: [{ name: "花生", type: "allergy", severity: "severe" }],
    medical_conditions_json: ["高血压"],
    kitchen_constraints_json: { servings: 2 },
    tracking_enabled: true,
  });
  assert.deepEqual(postgresHealthProfile.allergies_json, [{ name: "花生", type: "allergy", severity: "severe" }]);
  assert.deepEqual(postgresHealthProfile.medical_conditions_json, ["高血压"]);
  assert.equal(postgresHealthProfile.tracking_enabled, true);
  assert.equal(await healthRepository.removeLog(user.id + 1, Number(mergedHealthLog[0]?.id)), false);
  assert.equal(await healthRepository.removeLog(user.id, Number(mergedHealthLog[0]?.id)), true);

  const shoppingRepository = new PostgresShoppingRepository(pool);
  const shoppingItem = await shoppingRepository.create(
    "11111111-1111-4111-8111-111111111111",
    user.id,
    { name: "Postgres 番茄", amount: "2个", category: "蔬菜", checked: false },
  );
  assert.equal(shoppingItem.version, 1);
  assert.equal(await shoppingRepository.update(shoppingItem.id, user.id, { version: 2, checked: true }), null);
  const updatedShoppingItem = await shoppingRepository.update(shoppingItem.id, user.id, { version: 1, checked: true });
  assert.equal(updatedShoppingItem?.checked, true);
  const importShoppingItems = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      clientId: "postgres-shopping-import-0001:牛奶:1盒",
      input: { name: "牛奶", amount: "1盒", category: "乳制品", checked: false },
    },
  ];
  await Promise.all([
    shoppingRepository.importItems(user.id, importShoppingItems),
    shoppingRepository.importItems(user.id, [{ ...importShoppingItems[0]!, id: "33333333-3333-4333-8333-333333333333" }]),
  ]);
  const postgresShoppingItems = await shoppingRepository.list(user.id);
  assert.equal(postgresShoppingItems.filter((item) => item.name === "牛奶").length, 1);
  assert.equal(await shoppingRepository.remove(shoppingItem.id, user.id + 1), false);
  assert.equal(await shoppingRepository.remove(shoppingItem.id, user.id), true);

  const authAccountRepository = new PostgresAuthAccountRepository(pool);
  const authAccountService = new AuthAccountService(authAccountRepository);
  const registeredAuth = await authAccountService.register("postgres-auth@example.com", "PostgresAuth", "initialPass1");
  const authUserId = Number(registeredAuth.user.id);
  assert.equal((await authAccountService.me(authUserId)).must_change_password, 0);
  const loggedInAuth = await authAccountService.login("POSTGRES-AUTH@EXAMPLE.COM", "initialPass1", "127.0.0.7");
  assert.equal(loggedInAuth.rawIdentifier, "postgres-auth@example.com");
  assert.equal(loggedInAuth.user.last_login_ip, "127.0.0.7");
  await authAccountService.changePassword(authUserId, "initialPass1", "changedPass2");
  await assert.rejects(() => authAccountService.login("postgres-auth@example.com", "initialPass1", "127.0.0.7"), /密码错误/);
  assert.equal((await authAccountService.login("postgres-auth@example.com", "changedPass2", "127.0.0.7")).user.id, authUserId);
  await assert.rejects(() => authAccountService.updateProfile(authUserId, { username: "ADMIN" }), /用户名/);
  const profile = await authAccountService.updateProfile(authUserId, { username: "PostgresAuthUpdated", bio: "PostgreSQL 认证资料" });
  assert.equal(profile.bio, "PostgreSQL 认证资料");

  const usernameRace = await Promise.allSettled([
    authAccountService.register("postgres-auth-race-a@example.com", "PostgresRace", "racePass1"),
    authAccountService.register("postgres-auth-race-b@example.com", "postgresrace", "racePass1"),
  ]);
  assert.deepEqual(usernameRace.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM users WHERE LOWER(username)='postgresrace'")).rows[0]?.count), 1);

  await pool.query(`INSERT INTO ai_chat_messages (user_id,session_id,role,content,source,status,payload_json)
    VALUES ($1,'postgres-auth-export','user','导出测试','assistant','completed','{"kind":"auth"}'::jsonb)`, [authUserId]);
  await pool.query(`INSERT INTO inventory_scan_jobs (id,user_id,image_hash,status,result_json)
    VALUES ('postgres-auth-scan',$1,'postgres-auth-image','completed','[{"foodName":"番茄"}]'::jsonb)`, [authUserId]);
  await pool.query(`INSERT INTO agent_runs (id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES ('postgres-auth-run',$1,'postgres-auth-export','text','assistant','completed','{"message":"测试"}'::jsonb,'postgres-auth-thread')`, [authUserId]);
  await pool.query(`INSERT INTO agent_actions (id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES ('postgres-auth-action','postgres-auth-run',$1,'add_shopping_items','low','executed','{"items":[]}'::jsonb,'postgres-auth-action-key')`, [authUserId]);
  const authCheckpointConfig = await postgresCheckpointer.put(
    { configurable: { thread_id: "postgres-auth-thread", checkpoint_ns: "" } },
    {
      v: 1, id: "00000000-0000-6000-8000-000000000003", ts: new Date().toISOString(),
      channel_values: { message: "导出 checkpoint" }, channel_versions: { message: "1" }, versions_seen: {},
    },
    { source: "input", step: 0, parents: {} }, { message: "1" },
  );
  await postgresCheckpointer.putWrites(authCheckpointConfig, [["export_test", { exported: true }]], "auth-export-task");
  const exportedAuthData = await authAccountService.exportAiData(authUserId);
  assert.equal(typeof exportedAuthData.messages[0]?.payload_json, "string");
  assert.equal(typeof exportedAuthData.scan_jobs[0]?.result_json, "string");
  assert.equal(typeof exportedAuthData.agent_runs[0]?.input_json, "string");
  assert.equal(typeof exportedAuthData.agent_actions[0]?.payload_json, "string");
  assert.equal(exportedAuthData.agent_checkpoints.length, 1);
  assert.equal(typeof exportedAuthData.agent_checkpoints[0]?.checkpoint_json, "string");
  assert.equal(exportedAuthData.agent_checkpoint_blobs.length, 1);
  assert.equal(typeof exportedAuthData.agent_checkpoint_blobs[0]?.blob_base64, "string");
  assert.equal(exportedAuthData.agent_checkpoint_writes.length, 1);
  assert.equal(typeof exportedAuthData.agent_checkpoint_writes[0]?.value_base64, "string");
  const deletedAuthData = await authAccountService.deleteAiData(authUserId);
  assert.deepEqual({ messages: deletedAuthData.deleted.messages, scanJobs: deletedAuthData.deleted.scan_jobs,
    runs: deletedAuthData.deleted.agent_runs }, { messages: 1, scanJobs: 1, runs: 1 });
  assert.deepEqual((await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM checkpoints WHERE thread_id='postgres-auth-thread') AS checkpoints,
    (SELECT COUNT(*)::integer FROM checkpoint_blobs WHERE thread_id='postgres-auth-thread') AS blobs,
    (SELECT COUNT(*)::integer FROM checkpoint_writes WHERE thread_id='postgres-auth-thread') AS writes`)).rows[0],
  { checkpoints: 0, blobs: 0, writes: 0 });

  const deletingAccount = await authAccountService.register("postgres-delete@example.com", "PostgresDelete", "deletePass1");
  const deletingUserId = Number(deletingAccount.user.id);
  const successorAccount = await authAccountService.register("postgres-successor@example.com", "PostgresSuccessor", "successPass1");
  const successorUserId = Number(successorAccount.user.id);
  const deletionHouseholdId = Number((await pool.query(`INSERT INTO households (name,invite_code,owner_id)
    VALUES ('Postgres 删号家庭','PGDELETE',$1) RETURNING id`, [deletingUserId])).rows[0]?.id);
  await pool.query(`INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')`,
    [deletionHouseholdId,deletingUserId,successorUserId]);
  const deletionMediaUrl = `/media/uploads/community/${deletingUserId}/2026-09-01/photo.png`;
  await pool.query(`INSERT INTO community_posts (user_id,username,content,image_url,image_urls)
    VALUES ($1,'PostgresDelete','媒体清理事务',$2,$3)`, [deletingUserId,deletionMediaUrl,JSON.stringify([deletionMediaUrl])]);
  assert.equal((await authAccountService.deleteAccount(deletingUserId,"deletePass1")).success,true);
  assert.equal((await pool.query("SELECT 1 FROM users WHERE id=$1",[deletingUserId])).rowCount,0);
  assert.equal(Number((await pool.query("SELECT owner_id FROM households WHERE id=$1",[deletionHouseholdId])).rows[0]?.owner_id),successorUserId);
  assert.equal((await pool.query("SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2",[deletionHouseholdId,deletingUserId])).rowCount,0);
  const deletionCleanup = (await pool.query("SELECT urls_json,objects_json FROM media_cleanup_jobs WHERE owner_user_id=$1",[deletingUserId])).rows[0];
  assert.deepEqual(deletionCleanup?.urls_json,[deletionMediaUrl]);
  assert.equal(deletionCleanup?.objects_json[0]?.backend,"local");

  const communityRepository = new PostgresCommunityRepository(pool);
  const communityService = new CommunityService(communityRepository);
  const checkInResults = await Promise.all([
    communityRepository.checkIn(successorUserId, "2026-09-01"),
    communityRepository.checkIn(successorUserId, "2026-09-01"),
  ]);
  assert.deepEqual(checkInResults.sort(), [false, true]);
  const followResults = await Promise.all([
    communityRepository.toggleFollow(successorUserId, user.id),
    communityRepository.toggleFollow(successorUserId, user.id),
  ]);
  assert(followResults.every((result) => result.kind === "updated"));
  assert.deepEqual(followResults.map((result) => result.kind === "updated" && result.active).sort(), [false, true]);
  const followed = await communityRepository.toggleFollow(successorUserId, user.id);
  assert.equal(followed.kind === "updated" && followed.active, true);

  const questionResult = await communityRepository.createPost({
    userId: user.id,
    username: "PostgresAuthor",
    avatarUrl: null,
    category: "问答",
    content: "如何准备一份高蛋白燕麦早餐搭配？",
    imageUrls: [],
    eventStartAt: null,
    eventEndAt: null,
    questionStatus: "open",
    ipLocation: "集成测试",
    linkedRecipeId: null,
  });
  assert.equal(questionResult.kind, "created");
  if (questionResult.kind !== "created") throw new Error("PostgreSQL community question was not created");
  const questionId = Number(questionResult.post.id);
  const eventResult = await communityRepository.createPost({
    userId: user.id,
    username: "PostgresAuthor",
    avatarUrl: null,
    category: "活动",
    content: "一起完成七天健康早餐打卡活动",
    imageUrls: [],
    eventStartAt: "2026-09-01T00:00:00.000Z",
    eventEndAt: "2099-09-30T00:00:00.000Z",
    questionStatus: null,
    ipLocation: null,
    linkedRecipeId: null,
  });
  assert.equal(eventResult.kind, "created");
  if (eventResult.kind !== "created") throw new Error("PostgreSQL community event was not created");
  const eventId = Number(eventResult.post.id);

  const bookmarkResults = await Promise.all(Array.from({ length: 4 }, () => communityRepository.setPostBookmark(successorUserId, questionId, true)));
  assert(bookmarkResults.every((result) => result.kind === "updated" && result.bookmarked));
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM community_post_bookmarks WHERE user_id=$1 AND post_id=$2", [successorUserId, questionId])).rows[0].count), 1);
  assert.equal((await communityService.post(successorUserId, questionId)).is_bookmarked, true);
  assert.equal((await communityService.post(user.id, questionId)).is_bookmarked, false);
  assert.equal((await communityService.post(null, questionId)).is_bookmarked, false);
  const opposingBookmarks = await Promise.all([
    communityRepository.setPostBookmark(successorUserId, questionId, false),
    communityRepository.setPostBookmark(successorUserId, questionId, true),
  ]);
  assert(opposingBookmarks.every((result) => result.kind === "updated"));
  for (let i = 0; i < 2; i++) assert.deepEqual(await communityRepository.setPostBookmark(successorUserId, questionId, false), { kind: "updated", bookmarked: false });
  assert.equal((await communityService.post(successorUserId, questionId)).is_bookmarked, false);
  assert.deepEqual(await communityRepository.setPostBookmark(successorUserId, -1, true), { kind: "not_found" });

  const likeResults = await Promise.all([
    communityRepository.togglePostLike(successorUserId, questionId),
    communityRepository.togglePostLike(successorUserId, questionId),
  ]);
  assert.deepEqual(likeResults.map((result) => result.kind === "updated" && result.active).sort(), [false, true]);
  const liked = await communityRepository.togglePostLike(successorUserId, questionId);
  assert.equal(liked.kind === "updated" && liked.active && liked.count === 1, true);
  const joinResults = await Promise.all([
    communityRepository.toggleJoin(successorUserId, eventId, Date.now()),
    communityRepository.toggleJoin(successorUserId, eventId, Date.now()),
  ]);
  assert.deepEqual(joinResults.map((result) => result.kind === "updated" && result.active).sort(), [false, true]);
  const joined = await communityRepository.toggleJoin(successorUserId, eventId, Date.now());
  assert.equal(joined.kind === "updated" && joined.active && joined.count === 1, true);

  const comment = await communityRepository.createComment(successorUserId, questionId, "PostgresSuccessor", null, "可以提前浸泡燕麦并搭配鸡蛋。", null);
  assert(comment);
  const accepted = await communityRepository.acceptComment(user.id, questionId, Number(comment.id));
  assert.deepEqual(accepted, { kind: "updated", acceptedCommentId: Number(comment.id) });
  const commentLike = await communityRepository.toggleCommentLike(user.id, Number(comment.id));
  assert.equal(commentLike.kind === "updated" && commentLike.active && commentLike.count === 1, true);
  const comments = await communityService.comments(user.id, questionId);
  assert.equal(comments[0]?.is_accepted, true);
  assert.equal(comments[0]?.is_liked, true);

  const shareResults = await Promise.all([
    communityRepository.share(questionId, successorUserId, ["PGSHARE001"], "2099-10-01T00:00:00.000Z"),
    communityRepository.share(questionId, successorUserId, ["PGSHARE002"], "2099-10-01T00:00:00.000Z"),
  ]);
  assert(shareResults.every((result) => result && result !== "not_found"));
  assert.equal(shareResults[0] && shareResults[0] !== "not_found" ? shareResults[0].code : null,
    shareResults[1] && shareResults[1] !== "not_found" ? shareResults[1].code : null);
  const resolvedShare = await communityRepository.resolveShare(String(shareResults[0] && shareResults[0] !== "not_found" ? shareResults[0].code : ""));
  assert.equal(Number(resolvedShare?.post_id), questionId);
  assert.equal(resolvedShare?.content,"如何准备一份高蛋白燕麦早餐搭配？");

  await pool.query(`UPDATE user_health_profiles SET health_goal='lose_weight',allergies_json=$1::jsonb,
    dietary_restrictions_json=$2::jsonb WHERE user_id=$3`, [JSON.stringify([{ name: "花生" }]), JSON.stringify(["高盐"]), successorUserId]);
  const recommendationSource = await communityRepository.recommendationSource(successorUserId);
  assert.deepEqual(recommendationSource.health?.allergies_json, [{ name: "花生" }]);
  const feed = await communityService.posts(successorUserId, { sort: "recommended", pageSize: 1 });
  if (Array.isArray(feed.body)) throw new Error("PostgreSQL community cursor response was not returned");
  assert.equal(feed.body.items.length, 1);
  assert.equal(typeof feed.body.items[0]?.is_liked, "boolean");
  const viewed = await communityService.post(successorUserId, questionId);
  assert(Number(viewed.views_count) >= 1);
  const communityProfile = await communityService.profile(successorUserId, user.id);
  assert.equal(communityProfile.is_following, true);

  const adminCommunityRepository = new PostgresAdminCommunityRepository(pool);
  const moderationContext = { adminUserId:user.id,ipAddress:"127.0.0.1",userAgent:"postgres-integration" };
  const activeCommunityPosts = await adminCommunityRepository.listPosts({status:"active",cursorId:null,limit:2});
  assert.equal(activeCommunityPosts.length,2);
  const eventUpdated = await adminCommunityRepository.updateEvent(eventId,{startAt:"2026-09-02T00:00:00.000Z",endAt:"2099-10-01T00:00:00.000Z"},moderationContext);
  assert.equal(eventUpdated.kind,"updated");
  const reopened = await adminCommunityRepository.updateQuestion(questionId,{status:"open",acceptedCommentId:null},moderationContext);
  assert.equal(reopened.kind,"updated");
  const resolved = await adminCommunityRepository.updateQuestion(questionId,{status:"resolved",acceptedCommentId:Number(comment.id)},moderationContext);
  assert.equal(resolved.kind,"updated");
  assert.equal(await adminCommunityRepository.deleteComment(Number(comment.id),moderationContext),true);
  const moderatedQuestion=(await pool.query("SELECT question_status,accepted_comment_id,comment_count FROM community_posts WHERE id=$1",[questionId])).rows[0];
  assert.equal(moderatedQuestion?.question_status,"open");
  assert.equal(moderatedQuestion?.accepted_comment_id,null);
  assert.equal(Number(moderatedQuestion?.comment_count),0);
  assert.equal(await adminCommunityRepository.softDeletePost(eventId,moderationContext),true);
  assert.deepEqual(await communityRepository.setPostBookmark(successorUserId, eventId, true), { kind: "not_found" });
  assert.deepEqual(await communityRepository.setPostBookmark(successorUserId, eventId, false), { kind: "not_found" });
  const deletedCommunityPosts=await adminCommunityRepository.listPosts({status:"deleted",cursorId:null,limit:null});
  assert(deletedCommunityPosts.some((post)=>Number(post.id)===eventId));
  const moderationAudits=await pool.query(`SELECT action,details_json FROM admin_audit_logs WHERE admin_user_id=$1
    AND action LIKE 'community.%' ORDER BY id`,[user.id]);
  assert(moderationAudits.rows.some((audit)=>audit.action==="community.comment.delete"&&typeof audit.details_json?.contentPreview==="string"));

  const adminUsersRepository=new PostgresAdminUsersRepository(pool);
  const adminUsersService=new AdminUsersService(adminUsersRepository);
  const accessControlService=new AccessControlService(new PostgresAccessControlRepository(pool));
  const migratedAccessUser=await accessControlService.user(user.id);
  assert.equal(migratedAccessUser?.role,"admin");
  assert.equal(migratedAccessUser?.isDisabled,false);
  const migratedToken=await accessControlService.signUserToken(user.id);
  const migratedClaims=JSON.parse(Buffer.from(migratedToken.split(".")[1]!,"base64url").toString()) as Record<string,unknown>;
  assert.equal(migratedClaims.sessionVersion,migratedAccessUser?.sessionVersion);
  const bootstrapUserId=Number((await pool.query(`INSERT INTO users(username,email,password_hash)
    VALUES('Postgres Bootstrap','postgres-bootstrap@example.com','not-used') RETURNING id`)).rows[0].id);
  await accessControlService.ensureUserInitialState(bootstrapUserId);
  await accessControlService.ensureUserInitialState(bootstrapUserId);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM user_health_profiles WHERE user_id=$1",[bootstrapUserId])).rows[0].count),1);
  const postgresLevelRule=await adminUsersService.levelRule();
  postgresLevelRule.xp.dailyCheckIn=9;
  assert.equal((await adminUsersService.saveLevelRule(postgresLevelRule,moderationContext)).rule.xp.dailyCheckIn,9);
  assert.equal((await adminUsersService.levelRule()).xp.dailyCheckIn,9);
  const adminUsersPage=await adminUsersService.users({pageSize:2});
  assert(!Array.isArray(adminUsersPage)&&adminUsersPage.items.length===2);
  assert.equal(typeof (!Array.isArray(adminUsersPage)&&adminUsersPage.items[0]?.level.xp),"number");
  const adminHealth=await adminUsersService.healthProfile(successorUserId,moderationContext);
  assert(Array.isArray(adminHealth.profile?.allergies));
  const adjustedLevel=await adminUsersService.adjustLevel(successorUserId,25,"PostgreSQL 集成调整",moderationContext);
  assert(Number(adjustedLevel.level.adjustmentXp)>=25);
  const credentialUpdate=await adminUsersService.credentials(successorUserId,{identifier:"postgres-admin-updated@example.com",newPassword:"updatedPass1"},moderationContext);
  assert.equal(credentialUpdate.user.email,"postgres-admin-updated@example.com");
  const existingAdminEmail=String((await pool.query("SELECT email FROM users WHERE id<>$1 AND email IS NOT NULL LIMIT 1",[successorUserId])).rows[0]?.email);
  await assert.rejects(()=>adminUsersService.credentials(successorUserId,{identifier:existingAdminEmail},moderationContext),/已被其他账号/);
  assert.equal((await adminUsersService.expert(successorUserId,true,moderationContext)).is_verified_expert,true);
  assert.equal((await adminUsersService.status(user.id,successorUserId,true,moderationContext)).is_disabled,1);
  assert.equal((await adminUsersService.status(user.id,successorUserId,false,moderationContext)).is_disabled,0);
  assert.equal((await adminUsersService.role(user.id,successorUserId,"admin",moderationContext)).success,true);
  assert.equal((await adminUsersService.role(user.id,successorUserId,"user",moderationContext)).success,true);
  const adminUserAudits=await pool.query("SELECT details_json FROM admin_audit_logs WHERE admin_user_id=$1 AND action='user.credentials.update'",[user.id]);
  assert.equal(adminUserAudits.rows.at(-1)?.details_json?.passwordReset,true);

  const rateLimitsService = new RateLimitsService(new PostgresRateLimitsRepository(pool));
  const sharedStatuses = await Promise.all(Array.from({ length: 5 }, () =>
    rateLimitsService.consume("postgres-concurrent", "shared-client", 3, 60_000, 1_000_000)));
  assert.equal(sharedStatuses.filter((status) => !status.blocked).length, 3);
  assert.equal(sharedStatuses.filter((status) => status.blocked).length, 2);
  assert.equal(sharedStatuses.filter((status) => status.blocked).every((status) => status.retryAfterSeconds === 60), true);
  assert.equal((await rateLimitsService.consume("postgres-concurrent", "shared-client", 3, 60_000, 1_060_001)).blocked, false);
  await Promise.all(Array.from({ length: 5 }, (_, attempt) =>
    rateLimitsService.recordLoginFailure("postgres-rate@example.com", `192.0.2.${attempt + 1}`, 2_000_000)));
  assert.equal((await rateLimitsService.loginStatus("POSTGRES-rate@example.com", "198.51.100.1", 2_000_001)).blocked, true);
  await rateLimitsService.clearLoginFailures("postgres-rate@example.com");
  assert.equal((await rateLimitsService.loginStatus("postgres-rate@example.com", "198.51.100.1", 2_000_002)).blocked, false);

  const mediaCleanupRepository = new PostgresMediaCleanupRepository(pool);
  const mediaJobId = await mediaCleanupRepository.enqueue(user.id, ["/media/uploads/postgres-cleanup.png"], [
    { backend: "local", path: "/tmp/postgres-cleanup.png" },
  ]);
  const concurrentClaims = await Promise.all([
    mediaCleanupRepository.claim(mediaJobId, "postgres-claim-a", 30),
    mediaCleanupRepository.claim(mediaJobId, "postgres-claim-b", 30),
  ]);
  assert.equal(concurrentClaims.filter(Boolean).length, 1);
  const winningClaim = concurrentClaims.find(Boolean)!;
  assert.equal(await mediaCleanupRepository.complete(mediaJobId, "not-the-winning-claim"), false);
  await mediaCleanupRepository.release(mediaJobId, "not-the-winning-claim", "stale worker");
  assert.equal((await mediaCleanupRepository.job(mediaJobId, 30))?.claim_token, winningClaim.claim_token);
  await mediaCleanupRepository.release(mediaJobId, winningClaim.claim_token!, "integration retry");
  const deletedMediaReferences: unknown[] = [];
  const mediaCleanupService = new MediaCleanupService(mediaCleanupRepository, async (references) => {
    deletedMediaReferences.push(...references);
  });
  assert.equal(await mediaCleanupService.process(mediaJobId), true);
  assert.deepEqual(deletedMediaReferences, [{ backend: "local", path: "/tmp/postgres-cleanup.png" }]);
  const mediaCleanupPage = await mediaCleanupService.list({ status: "completed", page: 1, pageSize: 10 });
  assert(mediaCleanupPage.items.some((job) => job.id === mediaJobId && job.urlCount === 1));

  // Reset only this isolated integration database's fixtures so the real default
  // batch sees exactly 25 failed legacy jobs before the valid 26th job.
  await pool.query("DELETE FROM media_cleanup_jobs");
  deletedMediaReferences.length = 0;
  const previousStorageOrigin = process.env.SUPABASE_URL;
  const retiredStorageOrigin = "https://retired.example";
  process.env.SUPABASE_URL = "https://current.example";
  try {
    const legacyCleanupIds: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const result = await pool.query("INSERT INTO media_cleanup_jobs(owner_user_id,urls_json) VALUES($1,$2::jsonb) RETURNING id",
        [user.id, JSON.stringify([`${retiredStorageOrigin}/storage/v1/object/public/community-media/community/${user.id}/${index}.png`])]);
      legacyCleanupIds.push(Number(result.rows[0].id));
    }
    const nextCleanupId = await mediaCleanupRepository.enqueue(user.id, ["/media/uploads/next.png"], [{ backend: "local", path: "/tmp/next.png" }]);
    assert.deepEqual(await mediaCleanupService.processPending(), { checked: 25, completed: 0, failed: 25 });
    assert.deepEqual(deletedMediaReferences, []);
    assert.deepEqual(await mediaCleanupService.processPending(), { checked: 25, completed: 1, failed: 24 });
    assert.equal((await mediaCleanupRepository.job(nextCleanupId, 30))?.status, "completed");
    assert.deepEqual(deletedMediaReferences, [{ backend: "local", path: "/tmp/next.png" }]);
    for (const id of legacyCleanupIds) {
      const job = await mediaCleanupRepository.job(id, 30);
      assert.equal(job?.status, "pending");
      assert.ok(job!.attempts >= 1);
      assert.match(job!.last_error!, /无法定位/);
    }

    // Restore configuration, leaving the original persisted jobs untouched.
    process.env.SUPABASE_URL = retiredStorageOrigin;
    assert.deepEqual(await mediaCleanupService.processPending(), { checked: 25, completed: 25, failed: 0 });
    for (const id of legacyCleanupIds) assert.equal((await mediaCleanupRepository.job(id, 30))?.status, "completed");
    assert.deepEqual(deletedMediaReferences.slice(1).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      Array.from({ length: 25 }, (_, index) => ({ backend: "supabase", origin: retiredStorageOrigin,
        bucket: "community-media", objectPath: `community/${user.id}/${index}.png` }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    assert.deepEqual(await mediaCleanupService.processPending(), { checked: 0, completed: 0, failed: 0 });
  } finally {
    if (previousStorageOrigin === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousStorageOrigin;
  }

  await pool.query("DELETE FROM plan_maintenance_jobs");
  await pool.query("DELETE FROM plan_maintenance_events");
  const queueOtherUser = Number((await pool.query("SELECT id FROM users WHERE id<>$1 LIMIT 1",[user.id])).rows[0].id);
  await verifyMaintenanceQueue({ repeatReport: async id => {
    const duplicate = randomUUID();
    await pool.query("INSERT INTO plan_maintenance_jobs(id,user_id,status,attempts,rule_version,result_json) SELECT $1,user_id,status,attempts,rule_version,result_json-'notificationRecorded' FROM plan_maintenance_jobs WHERE id=$2",[duplicate,id]);
    return duplicate;
  },noticeCount: async id => (await pool.query("SELECT COUNT(*)::int n FROM notification_events WHERE metadata_json->>'jobId'=$1",[id])).rows[0].n,settings: new PostgresPlanMaintenanceRepository(pool),users: [user.id,queueOtherUser], repository: () => new PostgresMaintenanceQueueRepository(pool),
    seed: async (id,userId,at) => { await pool.query("INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,created_at) VALUES($1,$2,'eat',$1,$1,$3)",[id,userId,at]); },
    unprocessed: async () => (await pool.query("SELECT COUNT(*)::int n FROM plan_maintenance_events WHERE processed_at IS NULL")).rows[0].n,
    seedMeals: async userId => {
      await pool.query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date) VALUES('maintenance-plan',$1,'维护回归','2026-09-12','2026-09-20')",[userId]);
      for (const kind of ["mutable","confirmed","cooking","purchased","untouched"]) await pool.query(`INSERT INTO meal_plan_items
        (id,plan_id,user_id,planned_date,meal_type,title,status,confirmed_at) VALUES($1,'maintenance-plan',$2,'2026-09-12','午餐',$3,$4,$5)`,
        [`maintenance-${kind}`,userId,kind,kind === "cooking" ? "cooking" : "planned",kind === "confirmed" ? new Date().toISOString() : null]);
      await pool.query("INSERT INTO shopping_list_items(id,user_id,client_id,name,checked) VALUES('maintenance-purchase',$1,'meal-plan:maintenance-purchased:0','已采购',true)",[userId]);
    },
    mealState: async id => (await pool.query('SELECT version,planned_date AS "plannedDate" FROM meal_plan_items WHERE id=$1',[id])).rows[0],
    jobResult: async id => (await pool.query("SELECT result_json FROM plan_maintenance_jobs WHERE id=$1",[id])).rows[0].result_json,
    changeCount: async () => (await pool.query("SELECT COUNT(*)::int n FROM meal_plan_changes WHERE plan_id='maintenance-plan'")).rows[0].n,
    mutateInventory: async userId => { await pool.query("INSERT INTO inventory_items(user_id,food_name,category,quantity,expiration_date) VALUES($1,'新入库','其他','1份','2026-09-20')",[userId]); },
  });
  await pool.query("DELETE FROM plan_maintenance_jobs");
  await pool.query("DELETE FROM plan_maintenance_events");

  // Pause after the input rows are locked and prove both a new row and an update
  // cannot slip between fingerprint validation and commit.
  await pool.query("INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,created_at) VALUES('input-lock-event',$1,'eat','input-lock-event','batch',CURRENT_TIMESTAMP - INTERVAL '1 minute')",[user.id]);
  const inputQueue = new PostgresMaintenanceQueueRepository(pool);
  await inputQueue.enqueueEvents(new Date());
  const inputJob = await inputQueue.claim(new Date());
  assert.ok(inputJob);
  const capturedInputs = await inputQueue.inputs(inputJob);
  assert.ok(capturedInputs);
  const inputsLocked = Promise.withResolvers<void>();
  const allowCommit = Promise.withResolvers<void>();
  const guardedPool = new Proxy(pool, { get(target,key) {
    if (key === "connect") return async () => {
      const connection = await target.connect();
      return new Proxy(connection, { get(client,property) {
        if (property === "query") return async (...args: unknown[]) => {
          const result = await (client.query.bind(client) as (...args: unknown[]) => Promise<unknown>)(...args);
          if (typeof args[0] === "string" && args[0].startsWith("SELECT * FROM recipe_recommendation_events") && args[0].endsWith("FOR UPDATE")) {
            inputsLocked.resolve(); await allowCommit.promise;
          }
          return result;
        };
        const value = Reflect.get(client,property);
        return typeof value === "function" ? value.bind(client) : value;
      } });
    };
    const value = Reflect.get(target,key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const applyingInputs = new PostgresMaintenanceQueueRepository(guardedPool).applyChanges(inputJob,[],capturedInputs);
  await Promise.race([inputsLocked.promise,applyingInputs.then(() => { throw new Error("application ended before input lock check"); })]);
  const blockedWriter = await pool.connect();
  try {
    await blockedWriter.query("SET lock_timeout='100ms'");
    await assert.rejects(() => blockedWriter.query("INSERT INTO inventory_items(user_id,food_name,category,quantity,expiration_date) VALUES($1,'锁回归','其他','1份','2026-09-20')",[user.id]),
      (error: unknown) => (error as { code: string }).code === "55P03");
    await assert.rejects(() => blockedWriter.query("UPDATE inventory_items SET quantity='2份' WHERE id=(SELECT MIN(id) FROM inventory_items WHERE user_id=$1)",[user.id]),
      (error: unknown) => (error as { code: string }).code === "55P03");
    await assert.rejects(() => blockedWriter.query("UPDATE kitchenware_catalog SET name=name WHERE id=(SELECT MIN(id) FROM kitchenware_catalog)"),
      (error: unknown) => (error as { code: string }).code === "55P03");
  } finally { await blockedWriter.query("SET lock_timeout=0"); blockedWriter.release(); allowCommit.resolve(); }
  assert.equal((await applyingInputs).kind,"completed");
  await pool.query("INSERT INTO inventory_items(user_id,food_name,category,quantity,expiration_date) VALUES($1,'锁释放后','其他','1份','2026-09-20')",[user.id]);

  await verifyMaintenanceFlow(new PostgresMaintenanceQueueRepository(pool),queueOtherUser,async (sql,args = []) => {
    let parameter = 0;
    return (await pool.query(sql.replace(/\?/g,() => `$${++parameter}`),args)).rows;
  });

  await verifyWeeklyRoll(queueOtherUser,async (sql,args = []) => {
    let parameter = 0; return (await pool.query(sql.replace(/\?/g,() => `$${++parameter}`),args)).rows;
  },() => recommendationsService.weeklyPlan(queueOtherUser,{ startDate: "2036-09-13",mealTypes: ["lunch"],servings: 1 }));

  const originalPortionRecipe = Number((await pool.query("INSERT INTO recipes(title,ingredients_json,steps_json,status,serving_size) VALUES('原菜','[{\"name\":\"大米\",\"amount\":\"100g\"}]','[]','approved',1) RETURNING id")).rows[0].id);
  const replacementPortionRecipe = Number((await pool.query("INSERT INTO recipes(title,ingredients_json,steps_json,status,serving_size) VALUES('新菜','[{\"name\":\"大米\",\"amount\":\"200g\"}]','[]','approved',4) RETURNING id")).rows[0].id);
  await pool.query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,constraints_json) VALUES('portion-plan',$1,'份量回归','2026-09-12','2026-09-20',$2::jsonb)",
    [user.id,JSON.stringify({ executionItems: { "portion-meal": { servings: 1.5,recipeId: originalPortionRecipe,targetMealId: "target" } } })]);
  await pool.query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json) VALUES('portion-meal','portion-plan',$1,'2026-09-12','午餐','原菜',$2,'[{\"name\":\"大米\",\"amount\":\"150g\"}]')",[user.id,originalPortionRecipe]);
  await verifyPortionReplacement(new PostgresMealPlansRepository(pool),user.id,originalPortionRecipe,replacementPortionRecipe,async () =>
    (await pool.query("SELECT constraints_json FROM meal_plans WHERE id='portion-plan'")).rows[0].constraints_json.executionItems["portion-meal"]);

  const maintenance = new PlanMaintenanceService(new PostgresPlanMaintenanceRepository(pool), () => new Date("2026-09-12T05:00:00Z"));
  assert.equal((await maintenance.settings(user.id)).version, 0);
  const settingsInput = { enabled: true as const, version: 0, timeZone: "Asia/Shanghai", localTime: "08:15" };
  const maintenanceSaved = await maintenance.updateSettings(user.id, settingsInput);
  assert.equal(maintenanceSaved.nextCheckAt, "2026-09-12T00:15:00.000Z");
  assert.deepEqual(await new PlanMaintenanceService(new PostgresPlanMaintenanceRepository(pool)).settings(user.id), maintenanceSaved);
  await assert.rejects(() => maintenance.updateSettings(user.id, settingsInput), /刷新/);
  const settingsResults = await Promise.allSettled(["09:00", "10:00"].map(localTime => maintenance.updateSettings(user.id,
    { ...settingsInput, version: 1, localTime })));
  assert.equal(settingsResults.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(settingsResults.filter(result => result.status === "rejected").length, 1);
  const pausedMaintenance = await maintenance.updateSettings(user.id, { enabled: false, version: 2 });
  assert.equal(pausedMaintenance.nextCheckAt, null);
  assert.equal(pausedMaintenance.timeZone, "Asia/Shanghai");

  const workerRepository = new PostgresWorkerRepository(pool);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "postgres-worker-a", 60_000), true);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "postgres-worker-b", 60_000), false);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "postgres-worker-a", 60_000), false);
  assert.equal(await workerRepository.ownsLease("media-cleanup", "postgres-worker-a"), true);
  await pool.query(`
    UPDATE worker_task_leases SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE task_name = 'media-cleanup'
  `);
  assert.equal(await workerRepository.ownsLease("media-cleanup", "postgres-worker-a"), false);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "postgres-worker-b", 60_000), true);
  assert.equal(await workerRepository.releaseLease("media-cleanup", "postgres-worker-a"), false);
  assert.equal(await workerRepository.ownsLease("media-cleanup", "postgres-worker-b"), true);
  assert.equal(await workerRepository.releaseLease("media-cleanup", "postgres-worker-b"), true);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "stale-owner", 60_000), true);
  await workerRepository.createRun("stale-worker-result", "media-cleanup", "postgres-worker");
  await pool.query("UPDATE worker_task_leases SET lease_expires_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE task_name='media-cleanup'");
  assert.equal(await workerRepository.completeRun("stale-worker-result", "completed", 1,
    { processed: 1, succeeded: 1, failed: 0 }, null, "stale-owner"), false);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "new-owner", 60_000), true);
  assert.equal(await workerRepository.completeRun("stale-worker-result", "completed", 1,
    { processed: 1, succeeded: 1, failed: 0 }, null, "stale-owner"), false);
  assert.equal((await pool.query("SELECT status FROM worker_task_runs WHERE id='stale-worker-result'")).rows[0].status, "running");
  await workerRepository.failRun("stale-worker-result", 1, "lease lost");
  assert.equal(await workerRepository.releaseLease("media-cleanup", "new-owner"), true);
  const workerRuntime = new WorkerRuntime(workerRepository);
  const workerResult = await workerRuntime.run({
    taskName: "media-cleanup",
    workerId: "postgres-worker-runtime",
    run: async () => ({ processed: 3, succeeded: 3, failed: 0, details: { source: "postgres-integration" } }),
  });
  assert.equal(workerResult.status, "completed");
  const workerPage = await workerRepository.listRuns({
    taskName: "media-cleanup",
    status: "completed",
    page: 1,
    pageSize: 10,
  });
  const workerRun = workerPage.items.find((item) => item.id === workerResult.runId);
  assert.deepEqual(workerRun?.result, { source: "postgres-integration" });
  assert.equal(workerRun?.processed, 3);

  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dietdigidose_app_test') THEN
      CREATE ROLE dietdigidose_app_test NOLOGIN;
    END IF;
  END $$`);
  await pool.query("GRANT USAGE ON SCHEMA public TO dietdigidose_app_test");
  await pool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dietdigidose_app_test");
  await pool.query("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO dietdigidose_app_test");
  const permission = await pool.query(`
    SELECT
      has_table_privilege('dietdigidose_app_test', 'inventory_items', 'SELECT,INSERT,UPDATE,DELETE') AS table_access,
      has_schema_privilege('dietdigidose_app_test', 'public', 'CREATE') AS schema_create
  `);
  assert.equal(permission.rows[0]?.table_access, true);
  assert.equal(permission.rows[0]?.schema_create, false);

  const transactionClient = await pool.connect();
  try {
    await transactionClient.query("BEGIN");
    await transactionClient.query("UPDATE inventory_items SET quantity_value = 1 WHERE food_name = '番茄'");
    await transactionClient.query("ROLLBACK");
  } finally {
    transactionClient.release();
  }
  const rolledBack = await pool.query("SELECT quantity_value FROM inventory_items WHERE food_name = '番茄'");
  assert.equal(Number(rolledBack.rows[0]?.quantity_value), 200);

  // Repository assertions above leave synthetic runs in flight; they must not start model calls during the HTTP smoke.
  await pool.query("UPDATE agent_runs SET status='cancelled' WHERE status IN ('queued','running','awaiting_approval','awaiting_input')");
  process.env.DATABASE_DRIVER = "postgresql";
  process.env.DATABASE_URL = connectionString;
  process.env.REQUIRE_HTTPS = "0";
  const { createApp } = await import("../src/app.js");
  const app = await createApp();
  const runtimeServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
  const address = runtimeServer.address();
  assert(address && typeof address === "object");
  const health = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { databaseDriver: string }).databaseDriver, "postgresql");
  const { verifyStagingSmoke } = await import("./stagingSmokeAssertions.js");
  try {
    await verifyStagingSmoke(`http://127.0.0.1:${address.port}`);
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'staging-smoke-%@example.invalid'")).rows[0].n),0);
  } finally {
    await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    await app.locals.closeRuntime();
  }

  await verifyInventoryPrecision(inventoryRepository, user.id, async (sql, values = []) => {
    let parameter = 0;
    return (await pool.query(sql.replace(/\?/g, () => "$" + (++parameter)), values)).rows;
  });
  const shoppingOtherOwner = (await pool.query("SELECT id FROM users WHERE id <> $1 LIMIT 1", [user.id])).rows[0];
  assert.ok(shoppingOtherOwner);
  await verifyShoppingIntake(inventoryRepository, new PostgresShoppingRepository(pool), user.id, Number(shoppingOtherOwner.id));
  const { verifyPostgresBackup } = await import("./postgresBackupAssertions.js");
  await verifyFeedbackPostgres(pool, user.id);
  await verifyAccountSecurityPostgres(pool);
  await verifyOnboardingPostgres(pool);
  await verifyHealthProfilePostgres(pool);
  await verifyManualDietPostgres(pool);
  await verifyPostgresBackup(connectionString);
  const { verifyPostgresRecoveryApi } = await import("./postgresRecoveryApiAssertions.js");
  await verifyPostgresRecoveryApi(connectionString);
  const { verifyCommonProduction } = await import("./helpers/commonProduction.js");
  await verifyCommonProduction(mealPlanRepository, dietService, user.id, async (sql, values = []) => {
    let parameter = 0;
    return (await pool.query(sql.replace(/\?/g, () => `$${++parameter}`), values)).rows;
  }, cookingQueueRepository, async operation => {
    await pool.query(`CREATE FUNCTION common_production_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected common production failure'; END $$;
      CREATE TRIGGER common_production_failure BEFORE INSERT ON prepared_meal_allocations FOR EACH ROW EXECUTE FUNCTION common_production_failure();`);
    try { await assert.rejects(operation(), /injected common production failure/); }
    finally { await pool.query("DROP TRIGGER common_production_failure ON prepared_meal_allocations; DROP FUNCTION common_production_failure()"); }
  });



  const { verifyRecipeExecution } = await import("./helpers/recipeExecution.js");
  await verifyRecipeExecution(adminRecipesService, recipesService, recommendationsService, kitchenwareService, user.id, async (sql, values = []) => {
    let parameter = 0;
    return (await pool.query(sql.replace(/\?/g, () => `$${++parameter}`), values)).rows;
  }, mealPlanRepository);

  console.log(JSON.stringify({
    ok: true,
    tables: report.tableCount,
    rows: report.rowCount,
    schema: archive.baselineSchemaSha256,
    repeatedAndConcurrentImportVerified: true,
    postgresInventoryRepositoryVerified: true,
    postgresAiContextRepositoryVerified: true,
    postgresAIConversationsRepositoryVerified: true,
    postgresAdminAgentRunsRepositoryVerified: true,
    postgresAgentOperationsRepositoryVerified: true,
    postgresAgentCheckpointerVerified: true,
    postgresAgentRunsRepositoryVerified: true,
    postgresAgentSchedulingRepositoryVerified: true,
    postgresAIRuntimeRepositoryVerified: true,
    postgresAiToolDataRepositoryVerified: true,
    postgresAIWriteConfirmationsRepositoryVerified: true,
    postgresAdminAuditRepositoryVerified: true,
    postgresDietRecordsRepositoryVerified: true,
    postgresInsightsRepositoryVerified: true,
    postgresCookingQueueRepositoryVerified: true,
    postgresMealPlansRepositoryVerified: true,
    postgresVoicePacksRepositoryVerified: true,
    postgresKitchenwareRepositoryVerified: true,
    postgresRecommendationsRepositoryVerified: true,
    postgresRealtimeVoiceRepositoryVerified: true,
    postgresRecipesRepositoryVerified: true,
    postgresFeedbackRepositoryVerified: true,
    postgresFoodRepositoryVerified: true,
    postgresAdminConsoleRepositoryVerified: true,
    postgresHouseholdsRepositoryVerified: true,
    postgresHealthRepositoryVerified: true,
    postgresShoppingRepositoryVerified: true,
    postgresAuthAccountRepositoryVerified: true,
    postgresCommunityRepositoryVerified: true,
    postgresAdminCommunityRepositoryVerified: true,
    postgresAdminUsersRepositoryVerified: true,
    postgresRateLimitsRepositoryVerified: true,
    postgresMediaCleanupRepositoryVerified: true,
    postgresWorkerRepositoryVerified: true,
    postgresNotificationsRepositoryVerified: true,
    leastPrivilegeGrantVerified: true,
    rollbackVerified: true,
    postgresBackupRestoreVerified: true,
    postgresRecoveryHttpVerified: true,
    postgresApplicationRuntimeVerified: true,
  }, null, 2));
} finally {
  await pool.end();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
