import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { writeRecipeKitchenwareRequirements } from "../src/services/recipeKitchenwareRequirementWriter.js";

function createDatabase(extraConstraint = "") {
  const database = new Database(":memory:");
  database.exec(`CREATE TABLE recipe_kitchenware_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    catalog_id INTEGER NOT NULL,
    capability_code TEXT,
    role TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL,
    notes TEXT${extraConstraint}
  )`);
  return database;
}

const kitchenware = new Map([
  ["平底锅", { id: 1, name: "平底锅", confidence: 1 }],
  ["烤箱", { id: 2, name: "烤箱", confidence: 1 }],
]);

function write(database: Database.Database, names: string[]) {
  return writeRecipeKitchenwareRequirements(names, {
    replace: true,
    resolve: (name) => kitchenware.get(name) ?? null,
    enqueueReview: () => undefined,
    isAvailable: () => true,
    prepareRemove: () => {
      const remove = database.prepare(
        "DELETE FROM recipe_kitchenware_requirements WHERE recipe_id = ? AND role = ?",
      );
      return () => { remove.run(42, "required"); };
    },
    prepareInsert: () => {
      const insert = database.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
        VALUES (?, ?, NULL, ?, ?, ?, ?)`);
      return (resolved, rawName) => insert.run(
        42,
        resolved.id,
        "required",
        "curated",
        resolved.confidence,
        `映射自：${rawName}`,
      ).changes === 1;
    },
    runAtomically: (operation) => database.transaction(operation)(),
  });
}

describe("writeRecipeKitchenwareRequirements", () => {
  test("partial catalog guesses are queued for review rather than persisted as requirements", () => {
    const reviews: unknown[] = [];
    const result = writeRecipeKitchenwareRequirements(["迷你烤箱玩具"],{
      replace: false,isAvailable: () => true,
      resolve: () => ({ id: 2,name: "烤箱",confidence: 0.72 }),
      enqueueReview: (name,confidence) => { reviews.push({ name,confidence }); },
      prepareRemove: () => () => {},
      prepareInsert: () => () => { assert.fail("unreviewed mapping was persisted"); },
      runAtomically: operation => operation(),
    });
    assert.deepEqual(result,{ mapped: [],unresolved: ["迷你烤箱玩具"] });
    assert.deepEqual(reviews,[{ name: "迷你烤箱玩具",confidence: 0.72 }]);
  });
  test("atomically replaces existing requirements and reports persisted mappings", () => {
    const database = createDatabase();
    try {
      database.prepare(`INSERT INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
        VALUES (42, 99, NULL, 'required', 'legacy', 1, 'old')`).run();

      const result = write(database, [" 平底锅 ", "烤箱", "平底锅"]);
      const rows = database.prepare(`SELECT catalog_id, source, notes
        FROM recipe_kitchenware_requirements WHERE recipe_id = 42 ORDER BY catalog_id`).all();

      assert.deepEqual(result, {
        mapped: [
          { rawName: "平底锅", catalogId: 1, catalogName: "平底锅", confidence: 1 },
          { rawName: "烤箱", catalogId: 2, catalogName: "烤箱", confidence: 1 },
        ],
        unresolved: [],
      });
      assert.deepEqual(rows, [
        { catalog_id: 1, source: "curated", notes: "映射自：平底锅" },
        { catalog_id: 2, source: "curated", notes: "映射自：烤箱" },
      ]);
    } finally {
      database.close();
    }
  });

  test("preserves existing requirements when the schema is missing an insert column", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`CREATE TABLE recipe_kitchenware_requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        catalog_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL,
        notes TEXT
      )`);
      database.prepare(`INSERT INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, role, source, confidence, notes)
        VALUES (42, 99, 'required', 'legacy', 1, 'old')`).run();

      const result = write(database, ["烤箱"]);
      const rows = database.prepare(
        "SELECT catalog_id, source FROM recipe_kitchenware_requirements WHERE recipe_id = 42",
      ).all();

      assert.deepEqual(result, { mapped: [], unresolved: ["烤箱"] });
      assert.deepEqual(rows, [{ catalog_id: 99, source: "legacy" }]);
    } finally {
      database.close();
    }
  });

  test("rolls back the entire replacement when a constraint ignores one insert", () => {
    const database = createDatabase(", UNIQUE (catalog_id)");
    try {
      database.prepare(`INSERT INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
        VALUES (42, 99, NULL, 'required', 'legacy', 1, 'old')`).run();
      database.prepare(`INSERT INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
        VALUES (7, 2, NULL, 'required', 'curated', 1, 'occupied')`).run();

      assert.throws(() => write(database, ["平底锅", "烤箱"]), /厨具需求未写入：烤箱/);
      const rows = database.prepare(`SELECT recipe_id, catalog_id, source
        FROM recipe_kitchenware_requirements ORDER BY recipe_id`).all();

      assert.deepEqual(rows, [
        { recipe_id: 7, catalog_id: 2, source: "curated" },
        { recipe_id: 42, catalog_id: 99, source: "legacy" },
      ]);
    } finally {
      database.close();
    }
  });

  test("empty input clears the selected role without preparing an insert", () => {
    const database = createDatabase();
    try {
      database.prepare(`INSERT INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
        VALUES (42, 99, NULL, 'required', 'legacy', 1, 'old')`).run();

      assert.deepEqual(write(database, [" ", ""]), { mapped: [], unresolved: [] });
      const count = database.prepare(
        "SELECT COUNT(*) AS count FROM recipe_kitchenware_requirements WHERE recipe_id = 42",
      ).get() as { count: number };
      assert.equal(count.count, 0);
    } finally {
      database.close();
    }
  });
});
