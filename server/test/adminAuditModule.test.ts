import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AdminAuditRepository } from "../src/modules/adminAudit/repository.js";
import { AdminAuditService } from "../src/modules/adminAudit/service.js";
import { SqliteAdminAuditRepository } from "../src/modules/adminAudit/sqliteRepository.js";

describe("admin audit module", () => {
  test("records database-neutral audit events", async () => {
    let recorded: Parameters<AdminAuditRepository["record"]>[0] | undefined;
    const service = new AdminAuditService({ record: async (event) => { recorded = event; } });
    await service.record({ adminUserId: 3, action: "test.audit", resourceType: "test", resourceId: 9,
      summary: "测试审计", details: { safe: true }, ipAddress: "127.0.0.1", userAgent: "test" });
    assert.equal(recorded?.resourceId, 9);
    assert.deepEqual(recorded?.details, { safe: true });
  });

  test("keeps audit persistence best-effort", async () => {
    const original = console.error;
    let logged = "";
    console.error = (...values: unknown[]) => { logged = values.join(" "); };
    try {
      const service = new AdminAuditService({ record: async () => { throw new Error("audit unavailable"); } });
      await assert.doesNotReject(() => service.record({ adminUserId: 3, action: "test.audit", resourceType: "test", summary: "测试" }));
      assert.match(logged, /audit unavailable/);
    } finally {
      console.error = original;
    }
  });

  test("SQLite adapter serializes details and optional values", async () => {
    const database = new Database(":memory:");
    database.exec(`CREATE TABLE admin_audit_logs (id INTEGER PRIMARY KEY, admin_user_id INTEGER, action TEXT,
      resource_type TEXT, resource_id TEXT, summary TEXT, details_json TEXT, ip_address TEXT, user_agent TEXT)`);
    const repository = new SqliteAdminAuditRepository(database);
    await repository.record({ adminUserId: 4, action: "config.update", resourceType: "config", resourceId: 12,
      summary: "更新配置", details: { fields: ["model"] } });
    const row = database.prepare("SELECT * FROM admin_audit_logs").get() as Record<string, unknown>;
    assert.equal(row.resource_id, "12");
    assert.deepEqual(JSON.parse(String(row.details_json)), { fields: ["model"] });
    assert.equal(row.ip_address, null);
    database.close();
  });
});
