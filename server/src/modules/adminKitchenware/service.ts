import { capabilityUpdateSchema } from "./capabilities.js";
import { z } from "zod";
import { reviewToken } from "./mappingReview.js";
import { AdminKitchenwareError } from "./errors.js";
import type { AdminKitchenwareRepository } from "./repository.js";
import type { AuditContext, CatalogInput, Row } from "./types.js";

const ASSET_STATUSES = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);

function formatCatalog(row: Row): Row {
  const serialize = (value: unknown) => typeof value === "string" || value == null ? value : JSON.stringify(value);
  return { ...row, aliases: serialize(row.aliases), cooking_methods: serialize(row.cooking_methods) };
}

export class AdminKitchenwareService {
  private readonly repository: AdminKitchenwareRepository;
  constructor(repository: AdminKitchenwareRepository) { this.repository = repository; }

  async capabilityConfiguration(id: number) {
    const value = await this.repository.capabilityConfiguration(id);
    if (!value) throw new AdminKitchenwareError(404,"官方厨具不存在");
    return value;
  }
  async updateCapabilities(id: number, body: unknown, context: AuditContext) {
    const parsed = capabilityUpdateSchema.safeParse(body);
    if (!parsed.success) throw new AdminKitchenwareError(400,"能力条件无效，请核对容量、直径和热源");
    if (!await this.repository.updateCapabilities(id,parsed.data,context)) throw new AdminKitchenwareError(404,"官方厨具不存在");
    return { success: true };
  }
  async mappingReviews(query: Row) {
    const status = typeof query.status === "string" ? query.status : "pending";
    if (!["pending","approved","rejected"].includes(status)) throw new AdminKitchenwareError(400,"审核状态无效");
    const rows = await this.repository.mappingReviews(status);
    return { items: rows.slice(0,200).map<Row & { token: string }>(row => ({ ...row,token: reviewToken(row) })),hasMore: rows.length>200 };
  }
  async decideMapping(id: number,body: unknown,context: AuditContext) {
    const parsed = z.discriminatedUnion("decision",[
      z.object({ decision: z.literal("approved"),catalogId: z.number().int().positive(),token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
      z.object({ decision: z.literal("rejected"),token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    ]).safeParse(body);
    if (!parsed.success) throw new AdminKitchenwareError(400,"审核请求无效");
    await this.repository.decideMapping(id,parsed.data,context);
    return { success: true };
  }

  async catalog(query: Row) {
    const rows = await this.repository.listCatalog({
      search: typeof query.search === "string" ? query.search.trim() : "",
      category: typeof query.category === "string" && query.category !== "全部" ? query.category.trim() : "",
    });
    return rows.map(formatCatalog);
  }

  async createCatalog(body: Row, context: AuditContext) {
    const result = await this.repository.createCatalog(this.catalogInput(body), context);
    if (result.kind === "duplicate") throw new AdminKitchenwareError(409, "该官方厨具已存在");
    return formatCatalog(result.item);
  }

  async updateCatalog(id: number, body: Row, context: AuditContext) {
    const result = await this.repository.updateCatalog(id, this.catalogInput(body), context);
    if (result.kind === "missing") throw new AdminKitchenwareError(404, "官方厨具不存在");
    if (result.kind === "duplicate") throw new AdminKitchenwareError(409, "该官方厨具已存在");
    return formatCatalog(result.item);
  }

  async removeCatalog(id: number, context: AuditContext) {
    if (!await this.repository.removeCatalog(id, context)) throw new AdminKitchenwareError(404, "官方厨具不存在");
    return { success: true, message: "官方厨具已删除" };
  }

  assets(query: Row) { return this.repository.listAssets({
    search: typeof query.search === "string" ? query.search.trim() : "",
    category: typeof query.category === "string" && query.category !== "全部" ? query.category.trim() : "",
    status: typeof query.status === "string" && query.status !== "全部" ? query.status.trim() : "",
  }); }

  async updateAssetStatus(id: number, status: string, context: AuditContext) {
    if (!ASSET_STATUSES.has(status)) throw new AdminKitchenwareError(400, "无效的厨具状态");
    if (!await this.repository.updateAssetStatus(id, status, context)) throw new AdminKitchenwareError(404, "厨具不存在");
    return { success: true, message: "厨具状态已更新" };
  }

  async removeAsset(id: number, context: AuditContext) {
    if (!await this.repository.removeAsset(id, context)) throw new AdminKitchenwareError(404, "厨具不存在");
    return { success: true, message: "厨具已移入回收站" };
  }

  private catalogInput(body: Row): CatalogInput { return {
    name: String(body.name), category: String(body.category), aliases: body.aliases as string[],
    cookingMethods: body.cooking_methods as string[], careNote: body.care_note ? String(body.care_note) : null,
  }; }
}
