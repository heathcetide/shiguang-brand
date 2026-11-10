import { addLocalDays, parseDateKey, toLocalDateKey, toLocalTimeKey } from "./date";
import { daysUntilDateKey, getInventoryStatus, getExpirationBadgeConfig } from "./inventory";

describe("local calendar dates", () => {
  test("formats without UTC date shifting", () => {
    expect(toLocalDateKey(new Date(2026, 7, 3, 23, 59))).toBe("2026-08-03");
    expect(toLocalTimeKey(new Date(2026, 7, 3, 8, 5))).toBe("08:05");
  });

  test("adds calendar days across month boundaries", () => {
    expect(toLocalDateKey(addLocalDays(1, new Date(2026, 7, 31)))).toBe("2026-09-01");
  });

  test("rejects impossible date keys", () => {
    expect(parseDateKey("2026-02-30")).toBeNull();
  });
});

describe("inventory freshness", () => {
  const today = new Date(2026, 7, 3, 23, 30);

  test("uses inclusive three-day expiring status", () => {
    expect(daysUntilDateKey("2026-08-06", today)).toBe(3);
    expect(getInventoryStatus({ expiration_date: "2026-08-06", is_available: true }, today).freshness).toBe("expiring");
  });

  test("distinguishes expired and used-up inventory", () => {
    expect(getInventoryStatus({ expiration_date: "2026-08-02", is_available: true }, today).freshness).toBe("expired");
    expect(getInventoryStatus({ expiration_date: "2026-08-10", is_available: false }, today).freshness).toBe("used_up");
  });
});

 test("unknown expiry is displayed without claiming freshness", () => {
  const status = getInventoryStatus({ expiration_date: "", is_available: true });
  expect(status.daysRemaining).toBeNull();
  expect(getExpirationBadgeConfig(status).label).toBe("日期未知");
});
