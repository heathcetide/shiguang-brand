import type Database from "better-sqlite3";

/** Runs inside the migration transaction with foreign keys temporarily disabled. */
export function migrateBaseData(database: Database.Database) {
  const columns = database.prepare("PRAGMA table_info(ingredients_library)").all() as Array<{ name: string; notnull: number }>;
  if (columns.find(column => column.name === "calories_100g")?.notnull) {
    const { sql } = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ingredients_library'").get() as { sql: string };
    const nullable = sql.replace(/\bcalories_100g\s+REAL\s+NOT\s+NULL\b/i, "calories_100g REAL");
    if (nullable === sql) throw new Error("Unexpected ingredients calories schema; migration aborted");
    const artifacts = database.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='ingredients_library' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
    const sequence = database.prepare("SELECT seq FROM sqlite_sequence WHERE name='ingredients_library'").get() as { seq: number } | undefined;
    const temporary = nullable.replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)["`\[]?ingredients_library["`\]]?/i, "$1ingredients_library_base_data_next");
    if (temporary === nullable) throw new Error("Unexpected ingredients table definition; migration aborted");
    database.exec(temporary);
    const names = columns.map(column => `"${column.name.replaceAll('"', '""')}"`).join(",");
    database.exec(`INSERT INTO ingredients_library_base_data_next (${names}) SELECT ${names} FROM ingredients_library;
      DROP TABLE ingredients_library;
      ALTER TABLE ingredients_library_base_data_next RENAME TO ingredients_library;`);
    for (const artifact of artifacts) database.exec(artifact.sql);
    if (sequence) database.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='ingredients_library'").run(sequence.seq);
  }
  const add = (table: string, column: string, definition: string) => {
    const existing = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!existing.some(value => value.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  add("ingredients_library", "nutrition_status", "TEXT NOT NULL DEFAULT 'unspecified'");
  add("recipes", "automatic_inventory_write_allowed", "INTEGER NOT NULL DEFAULT 1");
  for (const table of ["recipes", "ingredients_library", "kitchenware_catalog"]) add(table, "base_data_payload", "TEXT");
  for (const table of ["users", "community_posts", "community_comments", "inventory_items", "recipe_favorites"]) {
    add(table, "is_demo", "INTEGER NOT NULL DEFAULT 0");
  }
  database.exec(`CREATE TABLE base_data_runtime_ids (
    collection TEXT NOT NULL, logical_id TEXT NOT NULL, target_table TEXT NOT NULL,
    target_id TEXT NOT NULL, imported_version TEXT NOT NULL,
    imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(collection,logical_id)
  );
  CREATE TRIGGER base_data_recipe_cooking_guard_insert BEFORE INSERT ON cooking_completions
  WHEN EXISTS (SELECT 1 FROM recipes WHERE id=NEW.recipe_id AND automatic_inventory_write_allowed=0)
  BEGIN SELECT RAISE(ABORT, 'Recipe is reference-only; automatic inventory writes are disabled'); END;
  CREATE TRIGGER base_data_recipe_cooking_guard_update BEFORE UPDATE OF recipe_id ON cooking_completions
  WHEN EXISTS (SELECT 1 FROM recipes WHERE id=NEW.recipe_id AND automatic_inventory_write_allowed=0)
  BEGIN SELECT RAISE(ABORT, 'Recipe is reference-only; automatic inventory writes are disabled'); END;`);
  database.exec(`CREATE TRIGGER base_data_prepared_guard_insert BEFORE INSERT ON prepared_meals
    WHEN EXISTS (SELECT 1 FROM recipes WHERE id=NEW.recipe_id AND automatic_inventory_write_allowed=0)
    BEGIN SELECT RAISE(ABORT, 'Recipe is reference-only; automatic inventory writes are disabled'); END;
    CREATE TRIGGER base_data_prepared_guard_update BEFORE UPDATE OF recipe_id ON prepared_meals
    WHEN EXISTS (SELECT 1 FROM recipes WHERE id=NEW.recipe_id AND automatic_inventory_write_allowed=0)
    BEGIN SELECT RAISE(ABORT, 'Recipe is reference-only; automatic inventory writes are disabled'); END;`);
}
