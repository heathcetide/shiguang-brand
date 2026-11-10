import { inventoryFieldEvidenceSchema, type InventoryFieldEvidence } from "@dietdigidose/contracts";

type Row = Record<string, any>;
const fields = ["food_name", "quantity", "storage_location", "expiration_date"] as const;
const unknown = () => ({ status: "unknown", source: "unknown", note: "未记录" } as const);
function metadata(value: unknown): Row | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : null;
  } catch { return null; }
}
function cleanEvidence(value: unknown): InventoryFieldEvidence {
  const result: InventoryFieldEvidence = {};
  const raw = metadata(value);
  for (const field of fields) {
    const entry = metadata(raw?.[field]);
    if (!entry) continue;
    // Internal derivation markers are not part of the public evidence contract.
    const parsed = inventoryFieldEvidenceSchema.safeParse({ [field]: {
      status: entry.status, source: entry.source, ...(entry.note === undefined ? {} : { note: entry.note }),
    } });
    result[field] = parsed.success ? parsed.data[field] : unknown();
  }
  return result;
}

/** A bounded history can be resumed only from an independently attested snapshot. */
export const SAVED_EVIDENCE_LOG_LIMIT = 128;
function snapshotValues(data: Row): Row | null {
  const values = metadata(data.field_values);
  if (data.saved_evidence_version !== 1 || !values ||
    !["food_name", "storage_location", "expiration_date", "quantity"].every(key => typeof values[key] === "string") ||
    !(values.quantity_value === null || typeof values.quantity_value === "number" && Number.isFinite(values.quantity_value)) ||
    !(values.quantity_unit === null || typeof values.quantity_unit === "string")) return null;
  return values;
}

/** Derivative evidence never establishes an anchor after gaps or corrupted logs. */
export function savedInventoryEvidence(item: Row, logs: Row[]): InventoryFieldEvidence {
  let evidence: InventoryFieldEvidence = {};
  let version = 0;
  let snapshot: Row | null = null;
  for (const log of logs) {
    const data = metadata(log.metadata_json);
    const nextVersion = data?.inventory_version;
    if (!data || !Number.isInteger(nextVersion) || nextVersion < 1 || nextVersion > Number(item.version)) {
      evidence = {}; version = 0; snapshot = null; continue;
    }
    const values = snapshotValues(data);
    if (values) {
      evidence = cleanEvidence(data.saved_field_evidence);
      snapshot = values;
      version = nextVersion;
      continue;
    }
    if (log.action === "created" && nextVersion === 1) {
      evidence = cleanEvidence(data.field_evidence);
      snapshot = null;
      version = 1;
      continue;
    }
    const contiguousConsumption = version > 0 && ["consume_all", "consume_partial"].includes(log.action) && nextVersion === version + 1;
    if (!contiguousConsumption) {
      evidence = {}; version = 0; snapshot = null; continue;
    }
    const quantity = cleanEvidence(data.field_evidence).quantity;
    const rawQuantity = metadata(metadata(data.field_evidence)?.quantity);
    // Consumption can retain or weaken certainty, never create/upgrade it.
    if (!quantity || !evidence.quantity || rawQuantity?.derived_from_version !== version || quantity.source !== evidence.quantity.source ||
      (quantity.status === "known" && evidence.quantity.status !== "known") ||
      (quantity.status === "estimated" && evidence.quantity.status === "unknown")) evidence.quantity = unknown();
    else evidence.quantity = quantity;
    if (snapshot) {
      snapshot = { ...snapshot, quantity_value: log.quantity_after == null ? null : Number(log.quantity_after), quantity_unit: log.quantity_unit };
      delete snapshot.quantity; // Consumption rewrites the label; the log attests the numeric remainder.
    }
    version = nextVersion;
  }
  if (version !== Number(item.version)) evidence = {};
  if (snapshot && ((snapshot.quantity !== undefined && snapshot.quantity !== item.quantity) ||
    snapshot.quantity_value !== (item.quantity_value == null ? null : Number(item.quantity_value)) || snapshot.quantity_unit !== item.quantity_unit)) delete evidence.quantity;
  for (const field of fields) {
    if (field !== "quantity" && snapshot && snapshot[field] !== item[field]) delete evidence[field];
    evidence[field] ??= unknown();
  }
  return evidence;
}

/** Display provenance is separate from the pre-existing operational quantity gate. */
export function editedInventoryEvidence(before: Row, after: Row, logs: Row[], source: "manual" | "ai", quantityMetadata: Row) {
  const evidence = savedInventoryEvidence(before, logs);
  for (const field of fields) {
    if (field === "quantity") continue;
    if (before[field] !== after[field]) evidence[field] = source === "manual"
      ? { status: after[field] ? "known" : "unknown", source: "user" }
      : unknown();
  }
  const sameQuantity = (before.quantity_value == null ? null : Number(before.quantity_value)) === (after.quantity_value == null ? null : Number(after.quantity_value)) && before.quantity_unit === after.quantity_unit;
  if (sameQuantity && before.quantity !== after.quantity) evidence.quantity = unknown();
  else if (!sameQuantity) evidence.quantity = cleanEvidence(quantityMetadata.field_evidence).quantity ?? unknown();
  // Do not let display-only uncertainty change FEFO/planning behavior. Preserve
  // the operational quantity exactly, including absence and derivation markers.
  const hadOperationalLog = !sameQuantity || Boolean(before.is_available) !== Boolean(after.is_available) || before.quantity_evidence != null;
  return { inventory_version: quantityMetadata.inventory_version, ...(hadOperationalLog ? quantityMetadata : {}), saved_evidence_version: 1, saved_field_evidence: evidence, field_values: {
    food_name: after.food_name, storage_location: after.storage_location, expiration_date: after.expiration_date,
    quantity: after.quantity, quantity_value: after.quantity_value == null ? null : Number(after.quantity_value), quantity_unit: after.quantity_unit ?? null,
  } };
}
