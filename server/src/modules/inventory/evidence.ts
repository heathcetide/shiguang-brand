export function quantityEvidenceStatus(metadata: unknown, currentVersion: unknown): "known" | "estimated" | "unknown" | undefined {
  if (metadata == null) return undefined; // Older/manual records have no recognition evidence.
  let value: Record<string, any>;
  try { value = typeof metadata === "string" ? JSON.parse(metadata) : metadata as Record<string, any>; }
  catch { return "unknown"; }
  const status = value?.field_evidence?.quantity?.status;
  if (!status || Number(value.inventory_version) !== Number(currentVersion)) return "unknown";
  return status === "known" || status === "estimated" ? status : "unknown";
}

/** Carry quantity provenance through a deterministic change, never upgrade estimates. */
export function nextQuantityEvidence(metadata: unknown, beforeVersion: number, nextVersion: number,
  mode: "preserve" | "manual" | "unverified", structured: boolean) {
  const status = quantityEvidenceStatus(metadata, beforeVersion);
  let previous: Record<string, any> = {};
  try { previous = typeof metadata === "string" ? JSON.parse(metadata) : metadata as Record<string, any> ?? {}; } catch {}
  const quantity = mode === "manual"
    ? { status: structured ? "known" : "unknown", source: "user" }
    : mode === "unverified"
      ? status === undefined ? null : { status: "unknown", source: "unknown" }
      : status === undefined ? null : { ...previous?.field_evidence?.quantity,
        status: structured ? status : "unknown", derived_from_version: beforeVersion };
  return { inventory_version: nextVersion, field_evidence: quantity ? { quantity } : {} };
}
