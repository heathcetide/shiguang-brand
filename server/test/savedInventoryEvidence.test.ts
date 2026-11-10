import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { savedInventoryEvidence, editedInventoryEvidence } from "../src/modules/inventory/savedEvidence.js";
import { SqliteInventoryRepository } from "../src/modules/inventory/sqliteRepository.js";
import { verifySavedInventoryEvidence } from "./helpers/savedInventoryEvidence.js";
const directory = mkdtempSync(join(tmpdir(), "saved-evidence-"));
let db: Database.Database;
before(async () => {
  process.env.DATABASE_PATH = join(directory, "test.sqlite"); process.env.ADMIN_INITIAL_PASSWORD = "EvidenceFixturePassword1234"; process.env.ENABLE_DEMO_SEED = "0";
  const storage = await import("../src/storage/db.js"); db = storage.db; storage.initDatabase();
});
after(() => { db?.close(); rmSync(directory, { recursive: true, force: true }); });
test("SQLite saved evidence round-trips edits and consumption, fences owner/deleted records and corrupt metadata", async () => {
  const user = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('saved-evidence-owner','unused')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('saved-evidence-other','unused')").run().lastInsertRowid);
  await verifySavedInventoryEvidence(new SqliteInventoryRepository(db), user, other, async (id, mode) => {
    if (mode === "gap") { db.prepare("DELETE FROM inventory_change_logs WHERE inventory_item_id=? AND id NOT IN (SELECT MAX(id) FROM inventory_change_logs WHERE inventory_item_id=?)").run(id, id); return; }
    db.prepare("UPDATE inventory_change_logs SET metadata_json='broken' WHERE inventory_item_id=?").run(id);
  });
});
const item = { version: 2, food_name: "米", storage_location: "常温", expiration_date: "" };
const known = { status: "known", source: "recognition" };
const log = (version: number, evidence: object, action = "created", extra = {}) => ({ action, metadata_json: { inventory_version: version, field_evidence: evidence, ...extra } });
test("ambiguous old edits, gaps, corrupt fields, future/old versions and mismatched values never restore evidence", () => {
  const original = log(1, { food_name: known, expiration_date: { status: "estimated", source: "rule" } });
  assert.equal(savedInventoryEvidence(item, [original]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [original, log(2, { quantity: known }, "adjusted")]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence({ ...item, version: 3 }, [original, log(3, { quantity: known }, "consume_partial")]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [log(2, { food_name: { status: "confirmed", source: "user" } })]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [log(3, { food_name: known })]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [log(2, { food_name: known }, "adjusted", { field_values: { food_name: "旧名称" } })]).food_name?.status, "unknown");
});
test("AI edit never manufactures user confirmation; text-only quantity edit invalidates old structured evidence", () => {
  const before = { ...item, version: 1, quantity: "1袋", quantity_value: 500, quantity_unit: "g" };
  const original = log(1, { food_name: known, quantity: { status: "estimated", source: "recognition" } });
  const result = editedInventoryEvidence(before, { ...before, version: 2, food_name: "面", quantity: "2袋" }, [original], "ai", { inventory_version: 2 });
  assert.equal(result.saved_field_evidence.food_name?.status, "unknown");
  assert.equal(result.saved_field_evidence.quantity?.status, "unknown");
});

test("unrelated legacy edit leaves quantity provenance absent for existing operational semantics", () => {
  const before = { ...item, version: 1, quantity: "500g", quantity_value: 500, quantity_unit: "g" };
  const result = editedInventoryEvidence(before, { ...before, version: 2, food_name: "新名称" }, [], "manual", { inventory_version: 2, field_evidence: {} });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "field_evidence"), false);
  assert.equal(result.saved_field_evidence.food_name?.source, "user");
});

test("unanchored, corrupt and gapped derivatives cannot certify any field", () => {
  const derivative = (v: number) => log(v, { quantity: { ...known, derived_from_version: v - 1 } }, "consume_partial");
  for (const logs of [[derivative(3)], [log(1, { quantity: known }), derivative(3)], [log(1, { quantity: known }), { action: "adjusted", metadata_json: "broken" }, derivative(3)]]) {
    assert.equal(savedInventoryEvidence({ ...item, version: 3 }, logs).quantity?.status, "unknown");
  }
});


test("shared owned lookup keeps active reads fenced and deleted history available after full consumption", async () => {
  const user = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('lookup-owner','unused')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('lookup-other','unused')").run().lastInsertRowid);
  const repository = new SqliteInventoryRepository(db);
  const stock = await repository.create(user, { food_name: "查找库存", category: "其他", quantity: "10g", quantity_value: 10, quantity_unit: "g", expiration_date: "", storage_location: "常温" });
  assert.deepEqual(await repository.findOwned(user, stock.id), stock);
  assert.equal(await repository.findOwned(other, stock.id), null);
  assert.equal(await repository.history(other, stock.id), null);
  assert.equal(await repository.history(user, 2147483647), null);
  const consumed = await repository.consume(user, { idempotency_key: "lookup-consume", source: "manual", items: [{ item_id: stock.id, version: stock.version, mode: "all" }] });
  assert.equal(consumed.items[0].quantity_value, 0);
  assert.equal(consumed.items[0].version, stock.version + 1);
  await repository.remove(user, consumed.items[0]);
  assert.equal(await repository.findOwned(user, stock.id), null);
  assert.equal(await repository.evidence(user, stock.id), null);
  assert.equal(await repository.history(other, stock.id), null);
  assert.deepEqual((await repository.history(user, stock.id))?.map(row => row.action), ["removed", "consume_all", "created"]);
  assert.deepEqual(await repository.update(user, stock.id, consumed.items[0].version + 1, { patch: { food_name: "已删除" }, nextQuantityValue: 0, nextQuantityUnit: "g" }), { kind: "conflict" });
});

test("evidence item and bounded history share a SQLite snapshot during a concurrent commit", async () => {
  const user = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('snapshot-owner','unused')").run().lastInsertRowid);
  const repository = new SqliteInventoryRepository(db);
  const stock = (await repository.bulkIntake(user, { idempotency_key: "snapshot-intake", source: "manual", items: [{ food_name: "快照库存", category: "其他", quantity: "10g", quantity_value: 10, quantity_unit: "g", expiration_date: "", storage_location: "常温", confirmed: true, source: "manual", field_evidence: { food_name: { status: "known", source: "user" } } }] })).items[0];
  const writer = new Database(join(directory, "test.sqlite"));
  let interleaved = false;
  let historyReads = 0;
  const observed = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(prepared, operation) {
            const method = Reflect.get(prepared, operation);
            if (operation === "get" && /SELECT \* FROM inventory_items/.test(sql)) return (...parameters: unknown[]) => {
              assert.equal(target.inTransaction, true);
              const row = prepared.get(...parameters);
              if (!interleaved) {
                interleaved = true;
                writer.transaction(() => {
                  writer.prepare("UPDATE inventory_items SET version=version+1,food_name='并发修改' WHERE id=?").run(stock.id);
                  writer.prepare("UPDATE inventory_change_logs SET metadata_json='broken' WHERE inventory_item_id=?").run(stock.id);
                })();
              }
              return row;
            };
            if (operation === "all" && /FROM inventory_change_logs/.test(sql)) return (...parameters: unknown[]) => {
              assert.equal(target.inTransaction, true);
              assert.equal(parameters.at(-1), 128);
              historyReads++;
              return prepared.all(...parameters);
            };
            return typeof method === "function" ? method.bind(prepared) : method;
          },
        });
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const snapshot = await new SqliteInventoryRepository(observed).evidence(user, stock.id);
    assert.equal(interleaved, true);
    assert.equal(historyReads, 1);
    assert.equal(snapshot?.inventory_version, stock.version);
    assert.deepEqual(snapshot?.field_evidence.food_name, { status: "known", source: "user" });
    const current = await repository.evidence(user, stock.id);
    assert.equal(current?.inventory_version, stock.version + 1);
    assert.equal(current?.field_evidence.food_name?.status, "unknown");
  } finally {
    writer.close();
  }
});

test("manual user evidence round-trips creation while legacy absent quantity keeps identical FEFO deductions", async () => {
  const { inventoryBulkIntakeSchema } = await import("@dietdigidose/contracts");
  const { buildFefoConsumptionPreviewFromCandidates } = await import("../src/services/inventoryQuantity.js");
  const repository = new SqliteInventoryRepository(db);
  const user = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('manual-evidence','unused')").run().lastInsertRowid);
  const explicit = { status: "known", source: "user" };
  const outcomes = [];
  for (const attested of [false,true]) {
    const field_evidence = attested ? {food_name:explicit,quantity:explicit,storage_location:explicit,expiration_date:explicit} : undefined;
    const input = inventoryBulkIntakeSchema.parse({idempotency_key:`manual-evidence-${attested}`,source:"manual",items:[{food_name:attested?"米":"面",quantity:"500g",quantity_value:500,quantity_unit:"g",category:"其他",storage_location:"冷藏",expiration_date:"2099-11-01",confirmed:true,source:"manual",field_evidence}]});
    const stock = (await repository.bulkIntake(user,input)).items[0];
    const evidence = (await repository.evidence(user,stock.id))!.field_evidence;
    for (const field of ["food_name","quantity","storage_location","expiration_date"] as const) {
      assert.equal(evidence[field]?.status,attested?"known":"unknown");
      if(attested) assert.equal(evidence[field]?.source,"user");
    }
    const candidates = (await repository.listPreviewCandidates(user)).filter(row=>row.id===stock.id);
    const preview = buildFefoConsumptionPreviewFromCandidates(candidates,[{food_name:stock.food_name,amount_value:200,unit:"g"}])[0];
    outcomes.push({covered:preview.fully_covered,deductions:preview.deductions.map(d=>[d.amount_value,d.unit])});
    const remaining = (await repository.consume(user,{idempotency_key:`manual-consume-${attested}`,source:"manual",items:[{item_id:stock.id,version:stock.version,mode:"amount",amount_value:200,unit:"g"}]})).items[0];
    assert.equal(remaining.quantity_value,300);
  }
  assert.deepEqual(outcomes,[{covered:true,deductions:[[200,"g"]]},{covered:true,deductions:[[200,"g"]]}]);
});
