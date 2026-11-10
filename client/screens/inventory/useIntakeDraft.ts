import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";
import { intakeDraftSchema, type IntakeDraft } from "./intakeEntry";

export function useIntakeDraft(key: string, userId: number, initial: IntakeDraft) {
  const [value, setValue] = useState(initial); const valueRef = useRef(initial);
  const [ready, setReady] = useState(false); const [error, setError] = useState("");
  const queue = useRef(Promise.resolve()); const mounted = useRef(true);
  const storageGeneration = useRef(getPrivateStorageGeneration(userId));
  useEffect(() => {
    mounted.current = true;
    void AsyncStorage.getItem(getUserStorageKey(key, userId)!).then(raw => {
      if (!mounted.current || storageGeneration.current !== getPrivateStorageGeneration(userId)) return;
      valueRef.current = raw ? intakeDraftSchema.parse(JSON.parse(raw)) : initial;
      setValue(valueRef.current); setReady(true);
    }).catch(() => { if (mounted.current) { setError("草稿读取失败，请关闭后重新打开再试"); } });
    return () => { mounted.current = false; };
  }, [key, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next: IntakeDraft) => {
    const generation = storageGeneration.current;
    valueRef.current = next; setValue(next);
    const pending = queue.current.catch(() => undefined).then(async () => {
      if (!await writeUserPrivateStorage(key, userId, generation, JSON.stringify(next))) throw new Error("账号已切换，请重新打开录入页面");
      if (mounted.current) setError("");
    });
    queue.current = pending;
    void pending.catch(() => { if (mounted.current) setError("草稿未保存到本机，请重试后再退出"); });
    return pending;
  };
  const clear = async () => {
    const generation = storageGeneration.current;
    await queue.current.catch(() => undefined);
    if (!await removeUserPrivateStorage(key, userId, generation)) return;
    valueRef.current = initial;
    if (mounted.current) { setValue(initial); setError(""); }
  };
  return { value, valueRef, ready, error, save, clear, mounted };
}
