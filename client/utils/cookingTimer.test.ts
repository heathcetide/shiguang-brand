import { changeTimer, parseTimer, timerValue } from "./cookingTimer";
test("wall time survives background and restart, and expiry never becomes negative", () => {
  const timer = { mode: "countdown" as const, seconds: 180, startedAt: 1000 };
  expect(timerValue(parseTimer(JSON.stringify(timer))!, 61000)).toBe(120);
  expect(timerValue(timer, 999000)).toBe(0);
});
test("pause freezes elapsed time, resume and extension use current remaining time", () => {
  const timer = { mode: "countdown" as const, seconds: 180, startedAt: 1000 };
  const paused = changeTimer(timer, { startedAt: null }, 61000);
  expect(timerValue(paused, 200000)).toBe(120);
  const resumed = changeTimer(paused, { startedAt: 200000 }, 200000);
  const extended = changeTimer(resumed, { seconds: timerValue(resumed, 230000) + 60 }, 230000);
  expect(timerValue(extended, 240000)).toBe(140);
});
test("stopwatch keeps elapsed time and rejects damaged persistence", () => {
  expect(timerValue({ mode: "stopwatch", seconds: 5, startedAt: 1000 }, 61000)).toBe(65);
  expect(parseTimer('{"mode":"countdown","seconds":-1,"startedAt":null}')).toBeNull();
  expect(parseTimer('invalid')).toBeNull();
});
