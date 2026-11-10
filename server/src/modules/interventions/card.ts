import { interventionCardSchema } from "@dietdigidose/contracts";

/** Explicit projection prevents exposing the stored policy input, device data, or other internal evidence. */
export function interventionCard(row: Record<string,unknown>,now = Date.now()) {
  const candidate = (typeof row.candidate_json === "string" ? JSON.parse(row.candidate_json) : row.candidate_json) as Record<string,unknown>;
  const rawExpiry = row.expires_at;
  const expires = rawExpiry instanceof Date ? rawExpiry : new Date(String(rawExpiry).includes("T") ? String(rawExpiry) : String(rawExpiry).replace(" ","T")+"Z");
  return interventionCardSchema.parse({ id: row.id,notificationId: Number(row.notification_id),kind: row.kind,
    status: row.status === "acted" ? "acted" : expires.getTime()<=now ? "expired" : row.status,
    title: candidate.title,body: candidate.body,whyNow: candidate.whyNow,expiresLabel: candidate.expiresLabel,
    expiresAt: expires.toISOString(),localDate: candidate.localDate,inventoryIds: candidate.inventoryIds,recipeIds: candidate.recipeIds,
    actions: row.status === "acted" || expires.getTime()<=now ? [] : candidate.actions,
    policyVersion: row.policy_version,decisionReason: row.decision_reason });
}
