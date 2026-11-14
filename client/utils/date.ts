const pad = (value: number) => String(value).padStart(2, "0");

/** App business calendar (diet records, nutrition rings, scoring). Matches Go `todayDateKey`. */
export const APP_TIME_ZONE = "Asia/Shanghai";

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/** Calendar date in Asia/Shanghai — use for diet / nutrition closed-loop dates. */
export const toAppDateKey = (date = new Date()) => {
  const parts = zonedParts(date, APP_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Clock time in Asia/Shanghai. */
export const toAppTimeKey = (date = new Date()) => {
  const parts = zonedParts(date, APP_TIME_ZONE);
  return `${parts.hour}:${parts.minute}`;
};

/** A calendar date in the device's local timezone, never shifted through UTC. */
export const toLocalDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A clock time in the device's local timezone. */
export const toLocalTimeKey = (date = new Date()) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const addLocalDays = (days: number, from = new Date()) => {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  date.setDate(date.getDate() + days);
  return date;
};

export const dateKeyAfterDays = (days: number, from = new Date()) =>
  toLocalDateKey(addLocalDays(days, from));

/** Offset days on the app (Shanghai) calendar, for diet/nutrition closed-loop dates. */
export const dateKeyAfterAppDays = (days: number, from = new Date()) => {
  const base = parseDateKey(toAppDateKey(from)) || from;
  return toLocalDateKey(addLocalDays(days, base));
};

export const parseDateKey = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};
