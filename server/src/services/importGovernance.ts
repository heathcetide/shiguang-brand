import { randomUUID } from "node:crypto";

import { db } from "../storage/db.js";

export type ImportKind = "ingredient" | "recipe";
export type ImportMutation = "insert" | "update";

const TABLES = {
  ingredient: {
    batches: "ingredient_import_batches",
    items: "ingredient_import_batch_items",
    content: "ingredients_library",
    contentId: "ingredient_id",
    revision: "source_version",
  },
  recipe: {
    batches: "recipe_import_batches",
    items: "recipe_import_batch_items",
    content: "recipes",
    contentId: "recipe_id",
    revision: "source_revision",
  },
} as const;

const RESTORABLE_COLUMNS = {
  ingredient: new Set([
    "name", "category", "calories_100g", "protein_100g", "carbs_100g", "fat_100g",
    "image_url", "source", "barcode", "brands", "micronutrients_json", "data_license",
    "deleted_at", "deleted_by", "normalized_name", "aliases_json", "search_keywords",
    "preparation_state", "quality_status", "source_version", "source_updated_at",
    "nutrition_basis", "edible_ratio", "review_notes",
  ]),
  recipe: new Set([
    "title", "description", "image_url", "cook_time", "difficulty", "calories", "protein",
    "carbs", "fat", "nutrition_json", "category", "tags", "steps_json", "ingredients_json",
    "source", "status", "external_id", "source_url", "data_license", "source_revision",
    "source_attribution", "deleted_at", "deleted_by", "quality_status", "nutrition_basis",
    "quality_issues_json", "canonical_key", "source_content_hash", "import_batch_id",
    "serving_size", "prep_time", "cuisine", "meal_types_json", "required_kitchenware_json",
    "optional_kitchenware_json", "duplicate_of_recipe_id", "withdrawn_at",
  ]),
} as const;

export function beginImportBatch(kind: ImportKind, input: {
  source: string;
  revision: string;
  dataLicense: string;
  dryRun?: boolean;
}) {
  const batchId = `${kind}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const table = TABLES[kind];
  db.prepare(`INSERT INTO ${table.batches} (id, source, ${table.revision}, data_license, status, stats_json)
    VALUES (?, ?, ?, ?, ?, '{}')`)
    .run(batchId, input.source, input.revision, input.dataLicense, input.dryRun ? "validated" : "running");
  return batchId;
}

export function trackImportMutation(kind: ImportKind, input: {
  batchId: string;
  contentId: number;
  action: ImportMutation;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}) {
  const table = TABLES[kind];
  db.prepare(`INSERT INTO ${table.items} (batch_id, ${table.contentId}, action, before_json, after_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(batch_id, ${table.contentId}) DO UPDATE SET
      after_json = excluded.after_json,
      action = CASE WHEN ${table.items}.action = 'insert' THEN 'insert' ELSE excluded.action END`)
    .run(input.batchId, input.contentId, input.action, input.before ? JSON.stringify(input.before) : null, JSON.stringify(input.after));
}

export function finishImportBatch(kind: ImportKind, batchId: string, input: {
  status: "validated" | "committed" | "failed";
  stats: Record<string, unknown>;
  errors?: unknown[];
}) {
  const table = TABLES[kind];
  db.prepare(`UPDATE ${table.batches} SET status = ?, stats_json = ?, error_json = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(input.status, JSON.stringify(input.stats), input.errors?.length ? JSON.stringify(input.errors) : null, batchId);
}

function restoreRow(kind: ImportKind, contentId: number, snapshot: Record<string, unknown>) {
  const allowed = RESTORABLE_COLUMNS[kind];
  const entries = Object.entries(snapshot).filter(([column]) => allowed.has(column as never));
  if (!entries.length) return;
  const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
  db.prepare(`UPDATE ${TABLES[kind].content} SET ${assignments} WHERE id = ?`)
    .run(...entries.map(([, value]) => value), contentId);
}

export function rollbackImportBatch(kind: ImportKind, batchId: string) {
  const table = TABLES[kind];
  const batch = db.prepare(`SELECT status FROM ${table.batches} WHERE id = ?`).get(batchId) as { status: string } | undefined;
  if (!batch) throw new Error(`导入批次不存在：${batchId}`);
  if (batch.status === "rolled_back") return { batchId, repeated: true, restored: 0, withdrawn: 0 };
  if (batch.status !== "committed") throw new Error(`只有 committed 批次可以回滚，当前状态：${batch.status}`);
  const items = db.prepare(`SELECT ${table.contentId} AS content_id, action, before_json FROM ${table.items}
    WHERE batch_id = ? ORDER BY rowid DESC`).all(batchId) as Array<{ content_id: number; action: ImportMutation; before_json: string | null }>;
  let restored = 0;
  let withdrawn = 0;
  db.transaction(() => {
    for (const item of items) {
      if (item.action === "insert") {
        if (kind === "ingredient") db.prepare("UPDATE ingredients_library SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.content_id);
        else db.prepare("UPDATE recipes SET deleted_at = CURRENT_TIMESTAMP, withdrawn_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.content_id);
        withdrawn += 1;
      } else if (item.before_json) {
        restoreRow(kind, item.content_id, JSON.parse(item.before_json));
        restored += 1;
      }
    }
    db.prepare(`UPDATE ${table.batches} SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP WHERE id = ?`).run(batchId);
  })();
  return { batchId, repeated: false, restored, withdrawn };
}

export function contentSnapshot(kind: ImportKind, contentId: number) {
  return db.prepare(`SELECT * FROM ${TABLES[kind].content} WHERE id = ?`).get(contentId) as Record<string, unknown> | undefined;
}
