import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(root, "server");
const requireFromServer = createRequire(path.join(serverRoot, "package.json"));
const Database = requireFromServer("better-sqlite3");
const checkOnly = process.argv.includes("--check");
const providedIndex = process.argv.indexOf("--sqlite");
const providedPath = providedIndex >= 0 ? process.argv[providedIndex + 1] : undefined;
const generatedSchemaPath = path.join(serverRoot, "src", "storage", "database", "postgres", "schema.generated.ts");
const manifestPath = path.join(serverRoot, "src", "storage", "database", "postgres", "baseline-manifest.json");

const BOOLEAN_COLUMNS = new Set([
  "recipes.automatic_inventory_write_allowed",
  "users.is_demo", "community_posts.is_demo", "community_comments.is_demo",
  "inventory_items.is_demo", "recipe_favorites.is_demo",
  "recommendation_learning_settings.enabled",
  "plan_maintenance_settings.enabled",
  "ai_usage_logs.success",
  "household_inventory_items.is_available",
  "household_shopping_items.checked",
  "inventory_items.is_available",
  "prepared_meals.is_reserved",
  "push_devices.is_active",
  "realtime_voice_transcript_chunks.is_final",
  "shopping_list_items.checked",
  "user_health_profiles.tracking_enabled",
  "user_notification_inbox.is_read",
  "user_notification_preferences.expiring_alert",
  "user_notification_preferences.meal_reminder",
  "user_notification_preferences.water_reminder",
  "user_notification_preferences.weekdays_enabled",
  "user_notification_preferences.weekends_enabled",
  "users.is_disabled",
  "users.is_verified_expert",
  "users.must_change_password",
]);
const JSON_COLUMNS = new Set(["kitchenware_catalog.aliases", "kitchenware_catalog.cooking_methods", "recipes.tags",
  "recipes.base_data_payload", "ingredients_library.base_data_payload", "kitchenware_catalog.base_data_payload"]);
const BIGINT_COLUMNS = new Set(["rate_limit_buckets.window_started_at", "rate_limit_buckets.blocked_until"]);
const POSTGRES_ONLY_UNIQUE_COLUMNS = new Set(["agent_runs.checkpoint_thread_id"]);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeString(value) {
  return JSON.stringify(String(value));
}

function variableName(value) {
  const camel = value.replace(/_([a-z0-9])/g, (_match, character) => character.toUpperCase());
  return /^\d/.test(camel) ? `table${camel}` : camel;
}

function propertyName(value) {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : escapeString(value);
}

function extractChecks(sqliteSql) {
  const checks = [];
  const source = sqliteSql || "";
  let cursor = 0;
  while (cursor < source.length) {
    const match = /\bCHECK\s*\(/gi.exec(source.slice(cursor));
    if (!match) break;
    const open = cursor + match.index + match[0].lastIndexOf("(");
    let depth = 1;
    let quote = null;
    let index = open + 1;
    for (; index < source.length && depth > 0; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote && source[index + 1] === quote) index += 1;
        else if (character === quote) quote = null;
      } else if (character === "'" || character === '"') quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
    }
    assert.equal(depth, 0, `Unbalanced CHECK constraint: ${source}`);
    checks.push(source.slice(open + 1, index - 1).trim());
    cursor = index;
  }
  return checks;
}

function targetKind(table, column) {
  const key = `${table.name}.${column.name}`;
  const sourceType = String(column.type || "TEXT").toUpperCase();
  if (BOOLEAN_COLUMNS.has(key)) return "boolean";
  if (JSON_COLUMNS.has(key) || column.name.endsWith("_json")) return "jsonb";
  if (BIGINT_COLUMNS.has(key)) return "bigint";
  // SQLite INTEGER affinity accepts fractional calories; the API preserves them too.
  if (key === "diet_records.calories") return "double precision";
  if (sourceType.includes("INT")) return "integer";
  if (sourceType.includes("REAL") || sourceType.includes("FLOA") || sourceType.includes("DOUB")) return "double precision";
  if (sourceType.includes("DATE") || sourceType.includes("TIME")) return "timestamp with time zone";
  if (sourceType.includes("BLOB")) return "bytea";
  return "text";
}

function defaultSql(table, column) {
  if (column.defaultValue == null) return null;
  const kind = targetKind(table, column);
  const raw = String(column.defaultValue).trim();
  if (/^CURRENT_TIMESTAMP$/i.test(raw)) return "CURRENT_TIMESTAMP";
  if (/^strftime\(\s*'%Y-%m-%d %H:%M:%f'\s*,\s*'now'\s*\)$/i.test(raw)) return "CURRENT_TIMESTAMP";
  if (kind === "boolean" && /^(0|1)$/.test(raw)) return raw === "1" ? "TRUE" : "FALSE";
  if (kind === "jsonb") return `${raw}::jsonb`;
  return raw;
}

function drizzleDefault(table, column) {
  const value = defaultSql(table, column);
  if (value == null) return "";
  const kind = targetKind(table, column);
  if (value === "CURRENT_TIMESTAMP") return ".defaultNow()";
  if (kind === "boolean") return `.default(${value === "TRUE"})`;
  if ((kind === "integer" || kind === "double precision") && /^-?\d+(?:\.\d+)?$/.test(value)) return `.default(${value})`;
  const quoted = /^'(.*)'$/s.exec(value);
  if (kind === "text" && quoted) return `.default(${escapeString(quoted[1].replaceAll("''", "'"))})`;
  return `.default(sql.raw(${escapeString(value)}))`;
}

function inspectDatabase(database) {
  const tableRows = database.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  const tables = tableRows.map((row) => {
    const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(row.name)})`).all().map((column) => ({
      cid: Number(column.cid),
      name: String(column.name),
      type: String(column.type || "TEXT"),
      notNull: Boolean(column.notnull),
      defaultValue: column.dflt_value == null ? null : String(column.dflt_value),
      primaryKeyOrder: Number(column.pk),
    }));
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(row.name)})`).all().map((foreignKey) => ({
      id: Number(foreignKey.id),
      sequence: Number(foreignKey.seq),
      table: String(foreignKey.table),
      from: String(foreignKey.from),
      to: String(foreignKey.to),
      onUpdate: String(foreignKey.on_update || "NO ACTION").toLowerCase().replaceAll(" ", " "),
      onDelete: String(foreignKey.on_delete || "NO ACTION").toLowerCase().replaceAll(" ", " "),
    }));
    const indexRows = database.prepare(`PRAGMA index_list(${quoteIdentifier(row.name)})`).all();
    const indexes = indexRows.map((indexRow) => {
      const definition = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexRow.name);
      const columnsInIndex = database.prepare(`PRAGMA index_xinfo(${quoteIdentifier(indexRow.name)})`).all()
        .filter((entry) => entry.key && entry.cid >= 0)
        .sort((left, right) => left.seqno - right.seqno)
        .map((entry) => ({ name: String(entry.name), desc: Boolean(entry.desc) }));
      const where = definition?.sql?.match(/\sWHERE\s+(.+)$/is)?.[1]?.trim() || null;
      return {
        name: String(indexRow.name),
        unique: Boolean(indexRow.unique),
        origin: String(indexRow.origin),
        partial: Boolean(indexRow.partial),
        columns: columnsInIndex,
        where,
      };
    });
    return {
      name: String(row.name),
      sqliteSql: String(row.sql || ""),
      autoIncrement: /\bAUTOINCREMENT\b/i.test(String(row.sql || "")),
      columns,
      foreignKeys,
      indexes,
      checks: extractChecks(String(row.sql || "")),
    };
  });
  const tableNames = new Set(tables.map((table) => table.name));
  for (const table of tables) {
    for (const foreignKey of table.foreignKeys) {
      assert(tableNames.has(foreignKey.table), `${table.name}.${foreignKey.from} references missing table ${foreignKey.table}`);
    }
  }
  return tables;
}

function renderDrizzleColumn(table, column, foreignKeysByColumn) {
  const kind = targetKind(table, column);
  const constructor = kind === "integer"
    ? `integer(${escapeString(column.name)})`
    : kind === "bigint"
      ? `bigint(${escapeString(column.name)}, { mode: "number" })`
    : kind === "double precision"
      ? `doublePrecision(${escapeString(column.name)})`
      : kind === "boolean"
        ? `boolean(${escapeString(column.name)})`
        : kind === "jsonb"
          ? `jsonb(${escapeString(column.name)})`
          : kind === "timestamp with time zone"
            ? `timestamp(${escapeString(column.name)}, { withTimezone: true, mode: "string" })`
            : kind === "bytea"
              ? `bytea(${escapeString(column.name)})`
              : `text(${escapeString(column.name)})`;
  const isSinglePrimaryKey = column.primaryKeyOrder > 0 && table.columns.filter((candidate) => candidate.primaryKeyOrder > 0).length === 1;
  let result = constructor;
  if (isSinglePrimaryKey && table.autoIncrement) result += ".generatedByDefaultAsIdentity()";
  if (isSinglePrimaryKey) result += ".primaryKey()";
  if (column.notNull || isSinglePrimaryKey) result += ".notNull()";
  result += drizzleDefault(table, column);
  const foreignKeys = foreignKeysByColumn.get(column.name) || [];
  if (foreignKeys.length === 1) {
    const foreignKey = foreignKeys[0];
    const options = [];
    if (foreignKey.onDelete !== "no action") options.push(`onDelete: ${escapeString(foreignKey.onDelete)}`);
    if (foreignKey.onUpdate !== "no action") options.push(`onUpdate: ${escapeString(foreignKey.onUpdate)}`);
    result += `.references((): AnyPgColumn => ${variableName(foreignKey.table)}.${propertyName(foreignKey.to)}${options.length ? `, { ${options.join(", ")} }` : ""})`;
  }
  return result;
}

function renderDrizzle(tables, sourceHash) {
  const lines = [
    "// Generated by scripts/generate-postgres-baseline.mjs. Do not edit by hand.",
    `// SQLite final-schema SHA-256: ${sourceHash}`,
    'import { sql } from "drizzle-orm";',
    'import type { AnyPgColumn } from "drizzle-orm/pg-core";',
    'import { bigint, boolean, check, customType, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";',
    'const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });',
    "",
  ];
  for (const table of tables) {
    const tableVariable = variableName(table.name);
    const groupedForeignKeys = new Map();
    for (const key of table.foreignKeys) {
      const group = groupedForeignKeys.get(key.id) || [];
      group.push(key);
      groupedForeignKeys.set(key.id, group);
    }
    const foreignKeysByColumn = new Map();
    for (const foreignKey of table.foreignKeys) {
      if (groupedForeignKeys.get(foreignKey.id).length > 1) continue;
      const entries = foreignKeysByColumn.get(foreignKey.from) || [];
      entries.push(foreignKey);
      foreignKeysByColumn.set(foreignKey.from, entries);
    }
    lines.push(`export const ${tableVariable} = pgTable(${escapeString(table.name)}, {`);
    for (const column of table.columns) {
      lines.push(`  ${propertyName(column.name)}: ${renderDrizzleColumn(table, column, foreignKeysByColumn)},`);
    }
    lines.push("}, (table) => [");
    for (const [id, group] of groupedForeignKeys) {
      if (group.length < 2) continue;
      const keys = group.sort((a,b) => a.sequence-b.sequence);
      const columns = keys.map(key => `table.${propertyName(key.from)}`).join(", ");
      const targets = keys.map(key => `${variableName(key.table)}.${propertyName(key.to)}`).join(", ");
      lines.push(`  foreignKey({ name: ${escapeString(`${table.name}_composite_fk_${id}`)}, columns: [${columns}], foreignColumns: [${targets}] }).onDelete(${escapeString(keys[0].onDelete)}).onUpdate(${escapeString(keys[0].onUpdate)}),`);
    }
    const primaryKeyColumns = table.columns.filter((column) => column.primaryKeyOrder > 0).sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder);
    if (primaryKeyColumns.length > 1) {
      lines.push(`  primaryKey({ name: ${escapeString(`${table.name}_pkey`)}, columns: [${primaryKeyColumns.map((column) => `table.${propertyName(column.name)}`).join(", ")}] }),`);
    }
    for (const column of table.columns) {
      if (POSTGRES_ONLY_UNIQUE_COLUMNS.has(`${table.name}.${column.name}`)) {
        lines.push(`  unique(${escapeString(`${table.name}_${column.name}_key`)}).on(table.${propertyName(column.name)}),`);
      }
    }
    for (const dbIndex of table.indexes) {
      if (dbIndex.origin === "pk") continue;
      if (dbIndex.origin === "u") {
        const name = `${table.name}_${dbIndex.columns.map((column) => column.name).join("_")}_key`;
        lines.push(`  unique(${escapeString(name)}).on(${dbIndex.columns.map((column) => `table.${propertyName(column.name)}`).join(", ")}),`);
        continue;
      }
      const builder = dbIndex.unique ? "uniqueIndex" : "index";
      const indexedColumns = dbIndex.columns.map((column) => `table.${propertyName(column.name)}${column.desc ? ".desc()" : ""}`).join(", ");
      const where = dbIndex.where ? `.where(sql.raw(${escapeString(dbIndex.where)}))` : "";
      lines.push(`  ${builder}(${escapeString(dbIndex.name)}).on(${indexedColumns})${where},`);
    }
    table.checks.forEach((expression, index) => {
      lines.push(`  check(${escapeString(`${table.name}_check_${index + 1}`)}, sql.raw(${escapeString(expression)})),`);
    });
    lines.push("]);", "");
  }
  return `${lines.join("\n")}\n`;
}

function buildManifest(tables, sourceHash) {
  return {
    version: 1,
    generatedFrom: "SQLite schema after initDatabase() and all schema_migrations",
    sourceSchemaSha256: sourceHash,
    tableCount: tables.length,
    indexCount: tables.flatMap((table) => table.indexes.filter((dbIndex) => dbIndex.origin !== "pk")).length,
    foreignKeyCount: tables.flatMap((table) => table.foreignKeys).length,
    tables: tables.map((table) => ({
      name: table.name,
      autoIncrement: table.autoIncrement,
      primaryKey: table.columns.filter((column) => column.primaryKeyOrder > 0).sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder).map((column) => column.name),
      foreignKeys: table.foreignKeys.map((foreignKey) => ({
        column: foreignKey.from,
        referencedTable: foreignKey.table,
        referencedColumn: foreignKey.to,
        onUpdate: foreignKey.onUpdate,
        onDelete: foreignKey.onDelete,
      })),
      columns: table.columns.map((column) => ({
        name: column.name,
        sqliteType: column.type || "TEXT",
        postgresType: targetKind(table, column),
        transform: targetKind(table, column) === "boolean"
          ? "0/1 -> false/true"
          : targetKind(table, column) === "bigint"
            ? "safe integer -> bigint"
          : targetKind(table, column) === "jsonb"
            ? "JSON text -> jsonb"
            : targetKind(table, column) === "timestamp with time zone"
              ? "SQLite UTC datetime -> timestamptz"
              : "identity",
        nullable: !column.notNull && column.primaryKeyOrder === 0,
      })),
    })),
  };
}

function writeOrCheck(filePath, content) {
  if (checkOnly) {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    if (current !== content) throw new Error(`${path.relative(root, filePath)} is stale; run pnpm -w database:schema:generate`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

let temporaryDirectory;
try {
  const sqlitePath = providedPath
    ? path.resolve(providedPath)
    : (() => {
        temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-postgres-baseline-"));
        return path.join(temporaryDirectory, "schema.db");
      })();
  if (!providedPath) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/materialize-sqlite-schema.ts"], {
      cwd: serverRoot,
      env: {
        ...process.env,
        ADMIN_INITIAL_PASSWORD: "schema-only-not-a-secret-1234",
        DATABASE_PATH: sqlitePath,
        ENABLE_DEMO_SEED: "0",
        NODE_ENV: "test",
      },
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`Unable to materialize SQLite schema:\n${result.stdout}\n${result.stderr}`);
  }
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const tables = inspectDatabase(database);
  database.close();
  const canonicalSource = JSON.stringify(tables);
  const sourceHash = createHash("sha256").update(canonicalSource).digest("hex");
  const manifest = `${JSON.stringify(buildManifest(tables, sourceHash), null, 2)}\n`;
  writeOrCheck(generatedSchemaPath, renderDrizzle(tables, sourceHash));
  writeOrCheck(manifestPath, manifest);
  console.log(`${checkOnly ? "Verified" : "Generated"} PostgreSQL baseline: ${tables.length} tables, ${tables.flatMap((table) => table.foreignKeys).length} foreign keys.`);
} finally {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
