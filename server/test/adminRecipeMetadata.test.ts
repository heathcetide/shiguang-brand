import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { AdminRecipesService } from "../src/modules/adminRecipes/service.js";
import { SqliteAdminRecipesRepository } from "../src/modules/adminRecipes/sqliteRepository.js";
import { verifyAdminRecipeMetadata } from "./helpers/adminRecipeMetadata.js";
const directory = mkdtempSync(join(tmpdir(), "recipe-metadata-"));
let db: Database.Database;
before(async () => {
  process.env.DATABASE_PATH = join(directory, "test.sqlite");
  process.env.ADMIN_INITIAL_PASSWORD = "RecipeMetadataFixture1234";
  process.env.ENABLE_DEMO_SEED = "0";
  const storage = await import("../src/storage/db.js"); db = storage.db; storage.initDatabase();
});
after(() => { db?.close(); rmSync(directory, { recursive: true, force: true }); });
test("SQLite admin edits preserve imported recipe provenance and honor explicit metadata", async () => {
  const adminId = Number((db.prepare("SELECT id FROM users LIMIT 1").get() as { id: number }).id);
  const repository = new SqliteAdminRecipesRepository(db);
  await verifyAdminRecipeMetadata(new AdminRecipesService(repository, { resolveCatalog: async () => null }),
    adminId, async (sql, values = []) => { const statement = db.prepare(sql); if (statement.reader) return statement.all(...values) as Record<string, unknown>[]; statement.run(...values); return []; }, repository);
});
