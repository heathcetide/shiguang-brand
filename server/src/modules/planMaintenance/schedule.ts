/** A persisted occurrence keeps its UTC instant across restarts; the local date is its dedup key. */
export type DailyCheckOccurrence = { localDate: string; scheduledAt: string };
export type DailyCheckSchedule = { timeZone: string; localTime: string };

function formatter(timeZone: string) {
  // Intl validates IANA time zones, including zones with non-hour offsets.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
}

function localParts(format: Intl.DateTimeFormat, instant: number) {
  const parts = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function dateNumber(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid local date");
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error("Invalid local date");
  return value;
}

function validatedFormatter(schedule: DailyCheckSchedule) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)) throw new Error("Invalid daily check time");
  if (!schedule.timeZone.trim()) throw new Error("A user time zone is required");
  return formatter(schedule.timeZone);
}

/**
 * Select the earliest UTC occurrence in a local day. A repeated clock hour runs once;
 * a skipped clock time runs at the first available minute after it. A skipped entire
 * calendar date has no occurrence. No process-local timers or system timezone are used.
 */
function occurrence(date: string, schedule: DailyCheckSchedule, format: Intl.DateTimeFormat): DailyCheckOccurrence | null {
  const midnight = dateNumber(date);
  // This window includes all modern IANA offsets and date-line transitions.
  for (let instant = midnight - 15 * 60 * 60_000; instant <= midnight + 39 * 60 * 60_000; instant += 60_000) {
    const local = localParts(format, instant);
    if (local.date === date && local.time >= schedule.localTime) {
      return { localDate: date, scheduledAt: new Date(instant).toISOString() };
    }
  }
  return null;
}

export function dailyCheckOccurrence(date: string, schedule: DailyCheckSchedule) {
  return occurrence(date, schedule, validatedFormatter(schedule));
}

/** Used on enable/timezone edits or after processing. Completion dates never move backwards. */
export function nextDailyCheck(now: Date, schedule: DailyCheckSchedule, lastCompletedLocalDate?: string | null): DailyCheckOccurrence {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Invalid current time");
  const format = validatedFormatter(schedule);
  const today = localParts(format, nowMs).date;
  const start = Math.max(dateNumber(today), lastCompletedLocalDate ? dateNumber(lastCompletedLocalDate) + 86_400_000 : 0);
  // Catch up today's check after a restart if it was not completed. Missed old dates
  // are coalesced into today's check instead of replaying obsolete week-plan inputs.
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    const result = occurrence(date, schedule, format);
    if (result) return result;
  }
  throw new Error("No daily check occurrence in the next three local dates");
}
