import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { dietApi, type DietRecordInput } from "@/services/api/diet";
import type { ApiFetch } from "@/services/api/client";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";

const storageName = "@pending_manual_diet_v1";
const pendingSchema = z.object({ idempotency_key: z.string().uuid(), meal_type: z.string(), food_name: z.string(), amount: z.string(), calories: z.number().nullable(), protein: z.number().nullable(), carbs: z.number().nullable(), fat: z.number().nullable(), recorded_at: z.string(), recorded_time: z.string().nullable().optional(), image_url: z.string().nullable() }).strict();
const identity = (input: DietRecordInput) => JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "idempotency_key").sort(([a], [b]) => a.localeCompare(b))));

/** Persist the confirmed request before sending, so an uncertain response survives restart. */
export function usePendingDietSave(userId: number | undefined, authFetch: ApiFetch) {
  const [state, setState] = useState<{ owner?: number; ready: boolean; pending: DietRecordInput | null; error: string }>({ ready: false, pending: null, error: "" });
  const owner = useRef(userId); const pending = useRef<DietRecordInput | null>(null); const sending = useRef(false);
  useLayoutEffect(() => { owner.current = userId; pending.current = null; }, [userId]);
  useEffect(() => {
    let active = true; const key = getUserStorageKey(storageName, userId);
    if (!key) return;
    void AsyncStorage.getItem(key).then(raw => {
      const value = raw ? pendingSchema.parse(JSON.parse(raw)) : null;
      if (active && owner.current === userId) { pending.current = value; setState({ owner: userId, ready: true, pending: value, error: "" }); }
    }).catch(() => { if (active) setState({ owner: userId, ready: false, pending: null, error: "上次保存状态读取失败，请重新打开页面后重试" }); });
    return () => { active = false; };
  }, [userId]);
  const save = async (input?: DietRecordInput) => {
    if (!userId || state.owner !== userId || !state.ready) throw new Error("正在恢复保存状态，请稍后重试");
    if (sending.current) throw new Error("正在保存，请稍候");
    const existing = pending.current;
    if (existing && input && identity(input) !== identity(existing)) throw new Error("上次记录尚未确认保存，请先返回列表重试上次记录，再添加新内容");
    const request = existing || (input ? { ...input, idempotency_key: Crypto.randomUUID() } : null);
    if (!request) throw new Error("没有需要重试的记录");
    const generation = getPrivateStorageGeneration(userId);
    const current = () => owner.current === userId && generation === getPrivateStorageGeneration(userId);
    sending.current = true;
    try {
      if (!await writeUserPrivateStorage(storageName, userId, generation, JSON.stringify(request)) || !current()) throw new Error("登录状态已变化，请重新打开页面");
      pending.current = request; setState({ owner: userId, ready: true, pending: request, error: "" });
      const saved = await dietApi.create(authFetch, request);
      await removeUserPrivateStorage(storageName, userId, generation);
      if (current()) { pending.current = null; setState({ owner: userId, ready: true, pending: null, error: "" }); }
      return saved;
    } catch (reason) {
      const status = reason && typeof reason === "object" && "status" in reason ? reason.status : null;
      // Definitive validation/deletion failures have no uncertain write to recover.
      if (status === 400 || status === 422 || status === 410) {
        await removeUserPrivateStorage(storageName, userId, generation);
        if (current()) pending.current = null;
      }
      if (current()) setState({ owner: userId, ready: true, pending: pending.current, error: reason instanceof Error ? reason.message : "保存失败，可重试上次记录" });
      throw reason;
    } finally { sending.current = false; }
  };
  return { save, pending: state.owner === userId ? state.pending : null, error: state.owner === userId ? state.error : "", ready: state.owner === userId && state.ready };
}
