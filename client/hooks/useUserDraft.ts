import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";

/** Drafts belong to a signed-in account and never become confirmed server data. */
export function useUserDraft<T>(name: string, initial: T, parse: (value: unknown) => T) {
  const { user } = useAuth();
  const userId = user?.id;
  const key = getUserStorageKey(name, userId);
  const initialRef = useRef(initial); const parseRef = useRef(parse);
  const owner = useRef(key);
  useLayoutEffect(() => { initialRef.current = initial; parseRef.current = parse; owner.current = key; }, [initial, parse, key]);
  const [state, setState] = useState<{ key: string | null; value: T; ready: boolean }>({ key, value: initial, ready: false });
  const [error, setError] = useState("");
  const pending = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    if (!key) return;
    void AsyncStorage.getItem(key).then(raw => {
      if (active && owner.current === key) {
        setError("");
        setState({ key, value: raw ? parseRef.current(JSON.parse(raw)) : initialRef.current, ready: true });
      }
    }).catch(() => {
      if (active && owner.current === key) {
        setError("上次草稿无法读取，本次填写仍可继续");
        setState({ key, value: initialRef.current, ready: true });
      }
    });
    return () => { active = false; };
  }, [key]);
  const save = useCallback((value: T) => {
    setState({ key, value, ready: true });
    if (!userId || !key) return Promise.resolve();
    const generation = getPrivateStorageGeneration(userId);
    // Serialize writes so a slow older keystroke cannot replace a newer draft.
    pending.current = pending.current.catch(() => undefined).then(async () => {
      if (owner.current !== key) throw new Error("登录状态已变化，请重新打开页面");
      try {
        if (!await writeUserPrivateStorage(name, userId, generation, JSON.stringify(value))) throw new Error("登录状态已变化，请重新打开页面");
        if (owner.current === key) setError("");
      } catch (reason) { if (owner.current === key) setError("草稿尚未保存到本机，请暂时不要退出"); throw reason; }
    });
    void pending.current.catch(() => undefined);
    return pending.current;
  }, [key, name, userId]);
  const clear = useCallback(async () => {
    if (!userId || !key) return;
    const generation = getPrivateStorageGeneration(userId);
    await pending.current.catch(() => undefined);
    if (owner.current !== key || generation !== getPrivateStorageGeneration(userId)) return;
    const removed = await removeUserPrivateStorage(name, userId, generation);
    if (removed && owner.current === key) setState({ key, value: initialRef.current, ready: true });
  }, [key, name, userId]);
  return { value: state.key === key ? state.value : initial, ready: !key || (state.key === key && state.ready), save, clear, error: state.key === key ? error : "" };
}
