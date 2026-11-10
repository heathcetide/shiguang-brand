import assert from "node:assert/strict";
import { buildFefoConsumptionPreviewFromCandidates } from "../../src/services/inventoryQuantity.js";
import { SAVED_EVIDENCE_LOG_LIMIT } from "../../src/modules/inventory/savedEvidence.js";
import { randomUUID } from "node:crypto";
import type { InventoryRepository } from "../../src/modules/inventory/repository.js";

export async function verifySavedInventoryEvidence(repository: InventoryRepository, userId: number, foreignUserId: number,
  corrupt: (itemId: number, mode?: "corrupt" | "gap") => Promise<void>) {
  const response = await repository.bulkIntake(userId, {
    idempotency_key: randomUUID(), source: "image", source_reference: randomUUID(), items: [{
      food_name: "依据合成番茄", category: "蔬菜", quantity: "500g", quantity_value: 500, quantity_unit: "g",
      storage_location: "冷藏", expiration_date: "2099-01-01", confirmed: true, source: "image", source_item_id: "0",
      field_evidence: { food_name: { status: "known", source: "recognition" }, quantity: { status: "estimated", source: "recognition" },
        storage_location: { status: "known", source: "user" }, expiration_date: { status: "estimated", source: "rule" } },
    }],
  });
  let item = response.items[0];
  const read = () => repository.evidence(userId, item.id);
  assert.equal((await read())?.field_evidence.quantity?.status, "estimated");
  assert.equal(await repository.evidence(foreignUserId, item.id), null);
  assert.equal(await repository.evidence(userId, 2147483647), null);
  const consumed = await repository.consume(userId, { idempotency_key: randomUUID(), source: "manual",
    items: [{ item_id: item.id, version: item.version, mode: "amount", amount_value: 100, unit: "g" }] });
  item = consumed.items[0];
  let evidence = (await read())!;
  assert.equal(evidence.inventory_version, item.version);
  assert.equal(evidence.field_evidence.food_name?.source, "recognition");
  assert.equal(evidence.field_evidence.expiration_date?.status, "estimated");
  assert.equal(evidence.field_evidence.quantity?.status, "estimated");
  const edited = await repository.update(userId, item.id, item.version, { patch: { food_name: "人工修正番茄" }, nextQuantityValue: item.quantity_value!, nextQuantityUnit: item.quantity_unit! });
  assert.equal(edited.kind, "updated");
  if (edited.kind !== "updated") throw new Error("update failed");
  item = edited.item;
  evidence = (await read())!;
  assert.equal(evidence.field_evidence.food_name?.source, "user");
  assert.equal(evidence.field_evidence.quantity?.status, "estimated");
  assert.equal(evidence.field_evidence.expiration_date?.status, "estimated");
  const quantityEdit = await repository.update(userId, item.id, item.version, { patch: { quantity: "350g", quantity_value: 350, quantity_unit: "g" }, nextQuantityValue: 350, nextQuantityUnit: "g" });
  assert.equal(quantityEdit.kind, "updated");
  if (quantityEdit.kind !== "updated") throw new Error("quantity edit failed");
  item = quantityEdit.item;
  evidence = (await read())!;
  assert.deepEqual(evidence.field_evidence.quantity, { status: "known", source: "user" });
  assert.equal(evidence.field_evidence.expiration_date?.status, "estimated");
  const afterSnapshotConsume = await repository.consume(userId, { idempotency_key: randomUUID(), source: "manual",
    items: [{ item_id: item.id, version: item.version, mode: "amount", amount_value: 50, unit: "g" }] });
  item = afterSnapshotConsume.items[0];
  assert.equal((await read())!.field_evidence.quantity?.status, "known");
  assert.equal((await read())!.field_evidence.expiration_date?.status, "estimated");
  await corrupt(item.id, "gap");
  assert.ok(Object.values((await read())!.field_evidence).every(field => field.status === "unknown"));
  await corrupt(item.id);
  assert.ok(Object.values((await read())!.field_evidence).every(field => field.status === "unknown"));
  await repository.remove(userId, item);
  assert.equal(await read(), null);
  const legacy = await repository.create(userId, { food_name: "旧记录", category: "其他", quantity: "1份", expiration_date: "", storage_location: "常温" });
  assert.ok(Object.values((await repository.evidence(userId, legacy.id))!.field_evidence).every(field => field.status === "unknown" && field.source === "unknown"));
  await repository.remove(userId, legacy);
  // Regression: changing only the text label must not change FEFO gates for
  // legacy, explicit-known, or estimated structured stock.
  for (const status of [undefined, "known", "estimated"] as const) {
    const input = { food_name: `FEFO-${status ?? "legacy"}`, category: "主食", quantity: "500g", quantity_value: 500, quantity_unit: "g" as const, expiration_date: "2099-01-01", storage_location: "常温" as const };
    let stock = status === undefined ? await repository.create(userId, input) : (await repository.bulkIntake(userId, { idempotency_key: randomUUID(), source: "manual", items: [{ ...input, confirmed: true, source: "manual", field_evidence: { quantity: { status, source: "user" } } }] })).items[0];
    const preview = async () => buildFefoConsumptionPreviewFromCandidates(await repository.listPreviewCandidates(userId), [{ food_name: input.food_name, amount_value: 100, unit: "g" }], "2026-10-21")[0];
    const previous = await preview();
    const oldGate = (await repository.listPreviewCandidates(userId)).find(row => row.id === stock.id)!.quantity_evidence_status;
    const result = await repository.update(userId, stock.id, stock.version, { patch: { quantity: "0.5kg" }, nextQuantityValue: 500, nextQuantityUnit: "g" });
    assert.equal(result.kind, "updated");
    if (result.kind !== "updated") throw new Error("text edit failed");
    stock = result.item;
    assert.deepEqual(await preview(), { ...previous, deductions: previous.deductions.map(row => ({ ...row, version: stock.version })) });
    assert.equal((await repository.listPreviewCandidates(userId)).find(row => row.id === stock.id)!.quantity_evidence_status, oldGate);
    assert.equal((await repository.evidence(userId, stock.id))!.field_evidence.quantity?.status, "unknown");
    await repository.remove(userId, stock);
  }
  let bounded = (await repository.bulkIntake(userId, { idempotency_key: randomUUID(), source: "manual", items: [{ food_name: "有界历史", category: "主食", quantity: "500g", quantity_value: 500, quantity_unit: "g", expiration_date: "2099-01-01", storage_location: "常温", confirmed: true, source: "manual", field_evidence: { quantity: { status: "known", source: "user" }, food_name: { status: "known", source: "user" } } }] })).items[0];
  for (let index = 0; index < SAVED_EVIDENCE_LOG_LIMIT; index++) {
    bounded = (await repository.consume(userId, { idempotency_key: randomUUID(), source: "manual", items: [{ item_id: bounded.id, version: bounded.version, mode: "amount", amount_value: 1, unit: "g" }] })).items[0];
  }
  assert.ok(Object.values((await repository.evidence(userId, bounded.id))!.field_evidence).every(field => field.status === "unknown"));
  const corrected = await repository.update(userId, bounded.id, bounded.version, { patch: { quantity: "400g", quantity_value: 400, quantity_unit: "g" }, nextQuantityValue: 400, nextQuantityUnit: "g" });
  assert.equal(corrected.kind, "updated");
  assert.equal((await repository.evidence(userId, bounded.id))!.field_evidence.quantity?.status, "known");
  await repository.remove(userId, corrected.kind === "updated" ? corrected.item : bounded);
}
