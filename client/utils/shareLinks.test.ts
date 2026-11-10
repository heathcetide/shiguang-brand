import { parseShareCode, parseSharedPostUrl } from "./shareLinks";

describe("community share links", () => {
  it("parses the native post deep link", () => {
    expect(parseSharedPostUrl("dietdigidose://post-detail?id=42&shareCode=ABCDEF1234"))
      .toBe(42);
  });

  it("rejects unrelated and invalid links", () => {
    expect(parseSharedPostUrl("https://example.com/post-detail?id=0")).toBeNull();
    expect(parseSharedPostUrl("dietdigidose://settings?id=42")).toBeNull();
  });

  it("extracts a case-insensitive SG share code", () => {
    expect(parseShareCode("分享码：SGabcdef1234")).toBe("ABCDEF1234");
  });
});
