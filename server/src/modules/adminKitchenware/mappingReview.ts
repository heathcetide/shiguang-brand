import { createHash } from "node:crypto";
import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { AdminKitchenwareError } from "./errors.js";
import type { Row } from "./types.js";
export type MappingDecision = { token: string; decision: "approved" | "rejected"; catalogId?: number };
export function reviewToken(row: Row) {
  return createHash("sha256").update(JSON.stringify([row.id,row.raw_name,row.normalized_name,row.source_type,row.source_id,row.confidence,row.suggested_catalog_id,row.status,row.created_at,row.reviewed_at])).digest("hex");
}
export function assertReview(row: Row | undefined, input: MappingDecision): asserts row is Row {
  if (!row) throw new AdminKitchenwareError(404,"映射审核不存在");
  if (row.status !== "pending" || reviewToken(row) !== input.token) throw new AdminKitchenwareError(409,"审核内容已变化，请刷新后核对");
}
function values(value: unknown): unknown[] { try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
export function reviewedAliases(review: Row, catalog: Row[], catalogId: number) {
  const target = catalog.find(item => Number(item.id) === catalogId && item.quality_status === "trusted");
  if (!target) throw new AdminKitchenwareError(409,"请选择当前已审核的标准厨具");
  const key = normalizeContentTerm(String(review.raw_name));
  if (!key) throw new AdminKitchenwareError(409,"原始词条无效，不能建立别名");
  for (const item of catalog) if (Number(item.id) !== catalogId && [item.name,...values(item.aliases)].some(name => typeof name === "string" && normalizeContentTerm(name) === key))
    throw new AdminKitchenwareError(409,"这个名称已属于另一标准厨具，请先处理目录冲突");
  const aliases = values(target.aliases).filter((value): value is string => typeof value === "string");
  if (![target.name,...aliases].some(name => normalizeContentTerm(String(name)) === key)) aliases.push(String(review.raw_name));
  return aliases;
}
export function reviewedRecipeRoles(review: Row, recipe: Row | undefined) {
  if (!recipe || recipe.deleted_at) throw new AdminKitchenwareError(409,"来源菜谱已删除，请刷新并拒绝过期审核");
  const matches = (value: unknown) => values(value).some(item => {
    const name = typeof item === "string" ? item : item && typeof item === "object" ? (item as Row).name : null;
    return typeof name === "string" && normalizeContentTerm(name) === String(review.normalized_name);
  });
  const roles = [matches(recipe.required_kitchenware_json) ? "required" : null,matches(recipe.optional_kitchenware_json) ? "optional" : null].filter((value): value is string => value !== null);
  if (!roles.length) throw new AdminKitchenwareError(409,"来源菜谱已不再使用该词条，请刷新并拒绝过期审核");
  return roles;
}
