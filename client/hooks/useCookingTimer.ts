import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { changeTimer, parseTimer, timerValue, type CookingTimer } from "@/utils/cookingTimer";
import { getPrivateStorageGeneration, getUserStorageKey, writeUserPrivateStorage } from "@/utils/userStorage";

const revisions = new Map<string, number>();
const pendingWrites = new Map<string, Promise<unknown>>();
export function useCookingTimer(userId: number | undefined, task: string, initialSeconds: number | undefined) {
  const base = `cooking-timer:${task}`;
  const key = getUserStorageKey(base, userId);
  const [timer, setTimer] = useState<CookingTimer>({ mode: "countdown", seconds: 180, startedAt: null });
  const current = useRef(timer);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const scope = useRef(0);
  const storageGeneration = useRef(0);
  useEffect(() => {
    const sequence = ++scope.current;
    if (!key || !userId || initialSeconds === undefined) return;
    const generation = getPrivateStorageGeneration(userId);
    storageGeneration.current = generation;
    void (async () => {
      await pendingWrites.get(key);
      const value = parseTimer(await AsyncStorage.getItem(key)) || { mode: "countdown" as const, seconds: initialSeconds, startedAt: null };
      if (sequence !== scope.current || generation !== getPrivateStorageGeneration(userId)) return;
      current.current = value; setTimer(value); setNow(Date.now()); setLoadedKey(key); setNotice("");
    })().catch(() => { if (sequence === scope.current) setNotice("计时记录读取失败，请退出后重试。"); });
    return () => { scope.current = sequence + 1; };
  }, [key, userId, initialSeconds]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 500);
    const subscription = AppState.addEventListener("change", tick);
    return () => { clearInterval(interval); subscription.remove(); };
  }, []);
  const update = useCallback((patch: Partial<CookingTimer> | ((value: CookingTimer, time: number) => Partial<CookingTimer>)) => {
    if (!key || !userId || loadedKey !== key || storageGeneration.current !== getPrivateStorageGeneration(userId)) return;
    const time = Date.now();
    const value = changeTimer(current.current, typeof patch === "function" ? patch(current.current, time) : patch, time);
    current.current = value; setTimer(value); setNow(time);
    const revision = (revisions.get(key) || 0) + 1;
    revisions.set(key, revision);
    const generation = storageGeneration.current;
    const sequence = scope.current;
    const active = () => generation === getPrivateStorageGeneration(userId) && revisions.get(key) === revision;
    let persisted = false;
    const write = (pendingWrites.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
      if (!active()) return;
      if (!await writeUserPrivateStorage(base, userId, generation, JSON.stringify(value))) return;
      persisted = true;
      if (!active()) return;
      if (Platform.OS !== "web") await Notifications.cancelScheduledNotificationAsync(key);
      let message = "切换步骤会保留当前计时；点重置可使用当前步骤时长。";
      if (value.startedAt !== null && value.mode === "countdown" && timerValue(value, Date.now()) > 0) {
        if (Platform.OS === "web") message = "网页关闭后不能响铃；重新打开会恢复实际剩余时间。";
        else {
          if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("cooking-timers", { name: "烹饪计时", importance: Notifications.AndroidImportance.HIGH, sound: "default" });
          let permission = await Notifications.getPermissionsAsync();
          if (permission.status !== "granted") permission = await Notifications.requestPermissionsAsync();
          if (!active()) return;
          if (permission.status !== "granted") message = "通知未获授权，后台无法提醒；返回页面可查看实际计时。";
          else if (timerValue(value, Date.now()) > 0) {
            await Notifications.scheduleNotificationAsync({ identifier: key,
              content: { title: "烹饪计时结束", body: "请检查锅中食物和火候。", sound: "default", data: { type: "cooking_timer", userId } },
              trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(value.startedAt + value.seconds * 1000), ...(Platform.OS === "android" ? { channelId: "cooking-timers" } : {}) },
            });
            if (!active()) await Notifications.cancelScheduledNotificationAsync(key);
          }
        }
      }
      if (scope.current === sequence) setNotice(message);
    }).catch(() => { if (scope.current === sequence) setNotice(persisted ? "计时已保存，但系统提醒更新失败，旧提醒可能仍响起；请重试暂停/继续。" : "计时保存失败，重开后可能恢复旧状态；请重试。当前显示仍按实际时间计算。"); });
    pendingWrites.set(key, write);
    void write.finally(() => { if (pendingWrites.get(key) === write) pendingWrites.delete(key); });
  }, [base, key, loadedKey, userId]);
  const ready = Boolean(key && loadedKey === key && initialSeconds !== undefined);
  const visible = ready ? timer : { mode: "countdown" as const, seconds: initialSeconds || 0, startedAt: null };
  const seconds = timerValue(visible, now);
  return {
    ready, notice: ready ? notice : "正在恢复计时…",
    timerSeconds: Math.ceil(seconds), timerMode: visible.mode,
    isTimerRunning: visible.startedAt !== null && (visible.mode === "stopwatch" || seconds > 0),
    setTimerSeconds: (value: number | ((old: number) => number)) => update((old, time) => ({ seconds: typeof value === "function" ? value(timerValue(old, time)) : value })),
    setIsTimerRunning: (value: boolean | ((old: boolean) => boolean)) => update((old, time) => ({ startedAt: (typeof value === "function" ? value(old.startedAt !== null && (old.mode === "stopwatch" || timerValue(old,time)>0)) : value) ? time : null })),
    setTimerMode: (mode: CookingTimer["mode"]) => update({ mode, startedAt: null }),
    finish: () => update({ seconds: 0, startedAt: null }),
  };
}
