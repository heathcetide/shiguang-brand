import { db } from "../storage/db.js";
import { normalizeContentTerm } from "./contentGovernance.js";
import { writeRecipeKitchenwareRequirements } from "./recipeKitchenwareRequirementWriter.js";

type Row = Record<string, unknown>;

function parseObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isSchemaDriftError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function tableExists(table: string) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table));
  } catch {
    return false;
  }
}

function tableHasColumn(table: string, column: string) {
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .some((row) => row.name === column);
  } catch {
    return false;
  }
}

export function resolveKitchenwareCatalog(rawName: string) {
  const normalized = normalizeContentTerm(rawName);
  if (!normalized) return null;

  const rows = (() => {
    try {
      const sql = tableHasColumn("kitchenware_catalog", "quality_status")
        ? "SELECT * FROM kitchenware_catalog WHERE quality_status = 'trusted'"
        : "SELECT * FROM kitchenware_catalog";
      return db.prepare(sql).all() as Row[];
    } catch (error) {
      if (isSchemaDriftError(error)) {
        return [];
      }
      throw error;
    }
  })();

  let best: { row: Row; score: number } | null = null;
  for (const row of rows) {
    let aliases: string[] = [];
    try { aliases = JSON.parse(String(row.aliases || "[]")); } catch { aliases = []; }
    const names = [String(row.name), ...aliases];
    const exact = names.some((name) => normalizeContentTerm(name) === normalized);
    const partial = names.some((name) => {
      const candidate = normalizeContentTerm(name);
      return candidate.includes(normalized) || normalized.includes(candidate);
    });
    const score = exact ? 1 : partial ? 0.72 : 0;
    if (score && (!best || score > best.score)) best = { row, score };
  }

  if (!best) return null;

  const capabilities = (() => {
    if (!tableExists("kitchenware_catalog_capabilities") || !tableExists("kitchenware_capabilities")) {
      return [] as Row[];
    }
    try {
      return db.prepare(`SELECT c.code, c.name, c.description, c.safety_level, cc.constraints_json
        FROM kitchenware_catalog_capabilities cc JOIN kitchenware_capabilities c ON c.code = cc.capability_code
        WHERE cc.catalog_id = ? ORDER BY c.code`).all(best.row.id) as Row[];
    } catch (error) {
      if (isSchemaDriftError(error)) return [] as Row[];
      throw error;
    }
  })();

  return {
    id: Number(best.row.id),
    name: String(best.row.name),
    category: String(best.row.category),
    confidence: best.score,
    attributes: parseObject(best.row.attributes_json),
    capabilities: capabilities.map((capability) => ({
      code: String(capability.code), name: String(capability.name), safetyLevel: String(capability.safety_level),
      constraints: parseObject(capability.constraints_json),
    })),
  };
}

export function enqueueKitchenwareMappingReview(rawName: string, sourceType: string, sourceId?: string | number, confidence = 0) {
  const normalized = normalizeContentTerm(rawName);
  if (!normalized) return;
  const suggestion = resolveKitchenwareCatalog(rawName);
  if (!tableExists("kitchenware_mapping_reviews")) return;
  try {
    db.prepare(`INSERT INTO kitchenware_mapping_reviews
      (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET
        raw_name = excluded.raw_name, confidence = excluded.confidence,
        suggested_catalog_id = excluded.suggested_catalog_id, status = 'pending', reviewed_at = NULL`)
      .run(rawName.trim(), normalized, sourceType, sourceId == null ? null : String(sourceId), confidence, suggestion?.id || null);
  } catch (error) {
    if (!isSchemaDriftError(error)) {
      throw error;
    }
  }
}

export function setRecipeKitchenwareRequirements(recipeId: number, names: string[], input: {
  role?: "required" | "optional" | "convenience";
  source?: string;
  replace?: boolean;
} = {}) {
  const role = input.role || "required";
  return writeRecipeKitchenwareRequirements(names, {
    replace: input.replace !== false,
    resolve: resolveKitchenwareCatalog,
    isAvailable: () => tableExists("recipe_kitchenware_requirements"),
    prepareRemove: () => {
      const remove = db.prepare("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id = ? AND role = ?");
      return () => { remove.run(recipeId, role); };
    },
    prepareInsert: () => {
      const insert = db.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
        VALUES (?, ?, NULL, ?, ?, ?, ?)`);
      return (resolved, rawName) => insert.run(
        recipeId,
        resolved.id,
        role,
        input.source || "curated",
        resolved.confidence,
        `映射自：${rawName}`,
      ).changes === 1;
    },
    runAtomically: (operation) => db.transaction(operation)(),
    enqueueReview: (rawName, confidence) => {
      enqueueKitchenwareMappingReview(rawName, "recipe", recipeId, confidence);
    },
  });
}
