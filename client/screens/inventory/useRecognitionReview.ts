import { useEffect, useLayoutEffect, useRef } from "react";
import { z } from "zod";
import { inventoryBulkIntakeSchema, inventoryFieldEvidenceSchema } from "@dietdigidose/contracts";
import { useAuth } from "@/contexts/AuthContext";
import { useUserDraft } from "@/hooks/useUserDraft";
import type { DetectedFood } from "./types";

const foodSchema = z.object({
  id: z.string(), foodName: z.string(), quantity: z.string(), suggestedStorageLocation: z.string(),
  estimatedExpireDays: z.number().nullable(), selected: z.boolean(),
  source: z.enum(["barcode", "receipt", "image", "manual", "recent"]).optional(),
  confidence: z.number().nullable().optional(), barcode: z.string().nullable().optional(),
  expirationDate: z.string().optional(), missingFields: z.array(z.string()).optional(),
  fieldEvidence: inventoryFieldEvidenceSchema.optional(),
});
const schema = z.object({ foods: z.array(foodSchema).max(100), batchKey: z.string(),
  source: z.enum(["barcode", "receipt", "image"]), jobId: z.string().nullable(), pending: inventoryBulkIntakeSchema.nullable() });
type Review = z.infer<typeof schema>;
const empty: Review = { foods: [], batchKey: "", source: "image", jobId: null, pending: null };
const parse = (value: unknown) => schema.parse(value);

export function useRecognitionReview(onRestore?: (value: Review) => void) {
  const { user } = useAuth();
  const restoredOwner = useRef<string | null>(null);
  const restoredCallback = useRef(onRestore);
  useLayoutEffect(() => { restoredCallback.current = onRestore; });
  const draft = useUserDraft("@inventory_recognition_review_v1", empty, parse);
  const current = useRef(draft.value);
  useLayoutEffect(() => { current.current = draft.value; }, [draft.value]);
  useEffect(() => {
    const scope = `${user?.id ?? "guest"}`;
    if (!draft.ready || restoredOwner.current === scope) return;
    restoredOwner.current = scope;
    restoredCallback.current?.(draft.value);
  }, [user?.id, draft.ready, draft.value]);
  const update = (patch: Partial<Review>) => {
    if (!draft.ready) throw new Error("正在恢复上次确认，请稍后重试");
    if (current.current.pending && !Object.prototype.hasOwnProperty.call(patch, "pending")) throw new Error("上次入库结果尚未确认，请先重试原请求");
    const next = schema.parse({ ...current.current, ...patch });
    current.current = next;
    return draft.save(next);
  };
  const setFoods = (value: DetectedFood[] | ((foods: DetectedFood[]) => DetectedFood[])) => {
    void update({ foods: typeof value === "function" ? value(current.current.foods) : value }).catch(() => undefined);
  };
  const submit = async (input: z.infer<typeof inventoryBulkIntakeSchema>, send: (request: z.infer<typeof inventoryBulkIntakeSchema>) => Promise<unknown>, active: () => boolean) => {
    const request = current.current.pending ?? inventoryBulkIntakeSchema.parse(input);
    await update({ pending: request });
    if (!active()) throw new Error("登录状态已变化，请重新打开页面");
    try { await send(request); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : null;
      if (active() && (status === 400 || status === 422 || status === 410)) await update({ pending: null });
      throw error;
    }
    if (active()) await draft.clear();
    return request;
  };
  const canPresent = (jobId: string) => !current.current.pending
    && (!current.current.foods.length || current.current.jobId === jobId);
  return { ...draft, current, update, setFoods, submit, canPresent };
}
