import { formatLocalDateTime, parseUtcDatabaseDate } from "./postDate";

describe("post date formatting", () => {
  it("treats timezone-less SQLite timestamps as UTC", () => {
    expect(parseUtcDatabaseDate("2026-08-13 05:30:10")?.toISOString())
      .toBe("2026-08-13T05:30:10.000Z");
  });

  it("formats the same UTC instant in the requested local timezone", () => {
    expect(formatLocalDateTime("2026-08-13 05:30:10", "Asia/Shanghai"))
      .toContain("13:30");
  });

  it("preserves explicit timezone offsets", () => {
    expect(parseUtcDatabaseDate("2026-08-13T13:30:10+08:00")?.toISOString())
      .toBe("2026-08-13T05:30:10.000Z");
  });
});
