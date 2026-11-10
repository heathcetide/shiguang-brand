const pad = (value: number) => String(value).padStart(2, "0");

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
