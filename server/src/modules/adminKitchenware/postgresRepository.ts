import { capabilityConfiguration, assertCapabilityUpdate, type CapabilityUpdate } from "./capabilities.js";
import { assertReview, reviewedAliases, reviewedRecipeRoles, type MappingDecision } from "./mappingReview.js";
import type { Pool, PoolClient } from "pg";
import type { AdminKitchenwareRepository } from "./repository.js";
import type { AssetQuery, AuditContext, CatalogInput, CatalogQuery, Row } from "./types.js";

function duplicate(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }

export class PostgresAdminKitchenwareRepository implements AdminKitchenwareRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async capabilityConfiguration(id: number) { return this.tx(async client => {
    if (!(await client.query("SELECT id FROM kitchenware_catalog WHERE id=$1 FOR SHARE",[id])).rows.length) return null;
    return capabilityConfiguration(id,(await client.query("SELECT capability_code,constraints_json FROM kitchenware_catalog_capabilities WHERE catalog_id=$1",[id])).rows,
      (await client.query("SELECT code,name,safety_level FROM kitchenware_capabilities ORDER BY code")).rows);
  }); }
  async updateCapabilities(id: number,input: CapabilityUpdate,audit: AuditContext) { return this.tx(async client => {
    if (!(await client.query("SELECT id FROM kitchenware_catalog WHERE id=$1 FOR UPDATE",[id])).rows.length) return false;
    const rows = (await client.query("SELECT capability_code,constraints_json FROM kitchenware_catalog_capabilities WHERE catalog_id=$1",[id])).rows;
    const available = (await client.query("SELECT code,name,safety_level FROM kitchenware_capabilities ORDER BY code")).rows;
    assertCapabilityUpdate(id,rows,available,input);
    await client.query("DELETE FROM kitchenware_catalog_capabilities WHERE catalog_id=$1",[id]);
    for (const capability of input.capabilities) await client.query("INSERT INTO kitchenware_catalog_capabilities(catalog_id,capability_code,constraints_json) VALUES($1,$2,$3::jsonb)",[id,capability.code,JSON.stringify(capability.constraints)]);
    await this.insertAudit(client,audit,"kitchenware_capabilities.update","kitchenware_catalog",id,JSON.stringify({ before: capabilityConfiguration(id,rows,available).capabilities,after: input.capabilities }));
    return true;
  }); }

  async mappingReviews(status: string) { return (await this.pool.query("SELECT * FROM kitchenware_mapping_reviews WHERE status=$1 ORDER BY id LIMIT 201",[status])).rows as Row[]; }
  async decideMapping(id: number,input: MappingDecision,audit: AuditContext) { await this.tx(async client => {
    const candidate = (await client.query("SELECT * FROM kitchenware_mapping_reviews WHERE id=$1",[id])).rows[0] as Row | undefined;
    assertReview(candidate,input);
    // Recipe writers lock the recipe before upserting its review; use that order.
    const recipe = input.decision === "approved" && candidate.source_type === "recipe"
      ? (await client.query("SELECT required_kitchenware_json,optional_kitchenware_json,deleted_at FROM recipes WHERE id=$1 FOR UPDATE",[candidate.source_id])).rows[0] : undefined;
    const row = (await client.query("SELECT * FROM kitchenware_mapping_reviews WHERE id=$1 FOR UPDATE",[id])).rows[0] as Row | undefined;
    assertReview(row,input);
    if (input.decision === "approved") {
      await client.query("LOCK TABLE kitchenware_catalog IN SHARE ROW EXCLUSIVE MODE");
      const aliases = reviewedAliases(row,(await client.query("SELECT * FROM kitchenware_catalog")).rows,input.catalogId!);
      const roles = row.source_type === "recipe" ? reviewedRecipeRoles(row,recipe) : [];
      await client.query("UPDATE kitchenware_catalog SET aliases=$1::jsonb WHERE id=$2",[JSON.stringify(aliases),input.catalogId!]);
      for (const role of roles) await client.query(`INSERT INTO recipe_kitchenware_requirements(recipe_id,catalog_id,role,source,confidence,notes)
        SELECT $1,$2,$3,'reviewed',1,$4 WHERE NOT EXISTS(SELECT 1 FROM recipe_kitchenware_requirements WHERE recipe_id=$1 AND catalog_id=$2 AND role=$3)`,[row.source_id,input.catalogId!,role,row.raw_name]);
    }
    await client.query("UPDATE kitchenware_mapping_reviews SET status=$1,suggested_catalog_id=$2,reviewed_at=CURRENT_TIMESTAMP WHERE id=$3",[input.decision,input.decision === "approved" ? input.catalogId! : row.suggested_catalog_id,id]);
    await this.insertAudit(client,audit,"kitchenware_mapping."+input.decision,"kitchenware_mapping",id,`厨具映射 ${input.decision}：${row.raw_name} → ${input.catalogId ?? '未映射'}`);
  }); }

  async listCatalog(input: CatalogQuery) {
    const filters: string[] = []; const values: string[] = [];
    if (input.search) { values.push(`%${input.search}%`); const value = `$${values.length}`;
      filters.push(`(name ILIKE ${value} OR aliases::text ILIKE ${value} OR cooking_methods::text ILIKE ${value} OR care_note ILIKE ${value})`); }
    if (input.category) { values.push(input.category); filters.push(`category=$${values.length}`); }
    return (await this.pool.query(`SELECT * FROM kitchenware_catalog ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY category, name`, values)).rows as Row[];
  }

  async createCatalog(input: CatalogInput, audit: AuditContext) {
    try { return await this.tx(async (client) => {
      const result = await client.query(`INSERT INTO kitchenware_catalog (name, category, aliases, cooking_methods, care_note)
        VALUES ($1,$2,$3::jsonb,$4::jsonb,$5) RETURNING *`, [input.name, input.category, JSON.stringify(input.aliases),
        JSON.stringify(input.cookingMethods), input.careNote]);
      const item = result.rows[0] as Row; await this.insertAudit(client, audit, "kitchenware_catalog.create", "kitchenware_catalog",
        Number(item.id), `新增官方厨具：${input.name}`); return { kind: "created" as const, item };
    }); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }

  async updateCatalog(id: number, input: CatalogInput, audit: AuditContext) {
    try { return await this.tx(async (client) => {
      const existing = (await client.query("SELECT name FROM kitchenware_catalog WHERE id=$1 FOR UPDATE", [id])).rows[0] as Row | undefined;
      if (!existing) return { kind: "missing" as const };
      const result = await client.query(`UPDATE kitchenware_catalog SET name=$1, category=$2, aliases=$3::jsonb,
        cooking_methods=$4::jsonb, care_note=$5 WHERE id=$6 RETURNING *`, [input.name, input.category, JSON.stringify(input.aliases),
        JSON.stringify(input.cookingMethods), input.careNote, id]);
      await this.insertAudit(client, audit, "kitchenware_catalog.update", "kitchenware_catalog", id,
        `更新官方厨具：${existing.name} → ${input.name}`);
      return { kind: "updated" as const, item: result.rows[0] as Row };
    }); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }

  async removeCatalog(id: number, audit: AuditContext) { return this.tx(async (client) => {
    const result = await client.query("DELETE FROM kitchenware_catalog WHERE id=$1 RETURNING name", [id]);
    const item = result.rows[0] as Row | undefined; if (!item) return false;
    await this.insertAudit(client, audit, "kitchenware_catalog.delete", "kitchenware_catalog", id, `删除官方厨具：${item.name}`);
    return true;
  }); }

  async listAssets(input: AssetQuery) {
    const filters = ["k.deleted_at IS NULL"]; const values: string[] = [];
    if (input.search) { values.push(`%${input.search}%`); const value = `$${values.length}`;
      filters.push(`(k.name ILIKE ${value} OR k.note ILIKE ${value} OR u.username ILIKE ${value})`); }
    if (input.category) { values.push(input.category); filters.push(`k.category=$${values.length}`); }
    if (input.status) { values.push(input.status); filters.push(`k.status=$${values.length}`); }
    return (await this.pool.query(`SELECT k.*, u.username AS owner_username FROM kitchenware_items k JOIN users u ON u.id=k.user_id
      WHERE ${filters.join(" AND ")} ORDER BY k.updated_at DESC, k.id DESC`, values)).rows as Row[];
  }

  async updateAssetStatus(id: number, status: string, audit: AuditContext) { return this.tx(async (client) => {
    const result = await client.query(`UPDATE kitchenware_items SET status=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND deleted_at IS NULL RETURNING name`, [status, id]);
    const item = result.rows[0] as Row | undefined; if (!item) return false;
    await this.insertAudit(client, audit, "kitchenware.status_update", "kitchenware", id, `更新厨具状态：${item.name} → ${status}`);
    return true;
  }); }

  async removeAsset(id: number, audit: AuditContext) { return this.tx(async (client) => {
    const result = await client.query(`UPDATE kitchenware_items SET deleted_at=CURRENT_TIMESTAMP, deleted_by=$1,
      updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND deleted_at IS NULL RETURNING name`, [audit.adminUserId, id]);
    const item = result.rows[0] as Row | undefined; if (!item) return false;
    await this.insertAudit(client, audit, "kitchenware.delete", "kitchenware", id, `将厨具移入回收站：${item.name}`);
    return true;
  }); }

  private insertAudit(client: PoolClient, context: AuditContext, action: string, resourceType: string, resourceId: number, summary: string) {
    return client.query(`INSERT INTO admin_audit_logs
      (admin_user_id, action, resource_type, resource_id, summary, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [context.adminUserId, action, resourceType, String(resourceId), summary, context.ipAddress || null, context.userAgent || null]);
  }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
