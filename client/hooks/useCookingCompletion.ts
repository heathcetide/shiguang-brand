import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, dietApi } from "@/services/api";
import type { ApiFetch } from "@/services/api/client";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";

type Completion = Parameters<typeof dietApi.completeCooking>[1];
const BASE_KEY = "cooking-completion-pending";

/** One unresolved production per account. A restart replays the exact durable payload. */
export function useCookingCompletion(userId: number | undefined, authFetch: ApiFetch) {
  const [pending, setPending] = useState<Completion | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const account = useRef(userId);
  account.current = userId;
  const generation = userId ? getPrivateStorageGeneration(userId) : 0;
  const current = useCallback(() => account.current === userId && Boolean(userId) && getPrivateStorageGeneration(userId!) === generation, [userId, generation]);
  useEffect(() => {
    let active = true;
    setPending(null); setReady(false); setError("");
    const key = getUserStorageKey(BASE_KEY, userId);
    if (!key) return;
    void AsyncStorage.getItem(key).then(stored => {
      if (!active || !current()) return;
      const value = stored ? JSON.parse(stored) as Completion : null;
      if (value && (!value.idempotency_key || !value.production)) throw new Error("制作待办无法读取，请保留本地数据并重试。");
      setPending(value); setReady(true);
    }).catch(reason => { if (active && current()) setError(reason instanceof Error ? reason.message : "制作待办读取失败"); });
    return () => { active = false; };
  }, [userId, current]);

  const submit = async (build: () => Promise<Completion | null>) => {
    if (busy.current) return null;
    if (!ready || !userId || !current()) throw new Error(error || "正在恢复制作记录，请稍后重试");
    busy.current = true;
    const key = getUserStorageKey(BASE_KEY, userId)!;
    try {
      // Read again before building: a previously confirmed request may have survived
      // a cleanup failure, and must never be replaced with refreshed inventory versions.
      const stored = await AsyncStorage.getItem(key);
      if (!current()) return null;
      const input: Completion | null = stored ? JSON.parse(stored) : await build();
      if (!input) return null;
      if (!await writeUserPrivateStorage(BASE_KEY, userId, generation, JSON.stringify(input))) return null;
      if (!current()) return null;
      setPending(input);
      const result = await dietApi.completeCooking(authFetch, input);
      if (!current()) return null;
      if (!await removeUserPrivateStorage("cooking-completion-pending", userId, generation)) return null;
      setPending(null);
      return result;
    } catch (reason) {
      // Only a definitive business rejection permits constructing a new operation.
      // Authorization expiry is cleaned by the account lifecycle; unknown failures stay durable.
      if (current() && reason instanceof ApiError && [400, 404, 409, 422].includes(reason.status)) {
        if (!await removeUserPrivateStorage("cooking-completion-pending", userId, generation)) return null;
        setPending(null);
      }
      throw reason;
    } finally { busy.current = false; }
  };
  return { pending, ready, error, submit };
}
