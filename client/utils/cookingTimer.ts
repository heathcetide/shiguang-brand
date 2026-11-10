export type CookingTimer = { mode: "countdown" | "stopwatch"; seconds: number; startedAt: number | null };
export function timerValue(timer: CookingTimer, now: number) {
  const elapsed = timer.startedAt === null ? 0 : Math.max(0, (now - timer.startedAt) / 1000);
  return Math.max(0, timer.seconds + (timer.mode === "countdown" ? -elapsed : elapsed));
}
export function changeTimer(timer: CookingTimer, patch: Partial<CookingTimer>, now: number): CookingTimer {
  const next = { ...timer, seconds: timerValue(timer, now), startedAt: timer.startedAt === null ? null : now, ...patch };
  if (next.mode === "countdown" && next.seconds <= 0) next.startedAt = null;
  return next;
}
export function parseTimer(raw: string | null): CookingTimer | null {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || !["countdown", "stopwatch"].includes(value.mode) || !Number.isFinite(value.seconds) || value.seconds < 0 ||
      !(value.startedAt === null || (Number.isFinite(value.startedAt) && value.startedAt > 0))) return null;
    return { mode: value.mode, seconds: value.seconds, startedAt: value.startedAt };
  } catch { return null; }
}
