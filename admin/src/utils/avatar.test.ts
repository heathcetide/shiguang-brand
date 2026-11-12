import { describe, expect, it } from "vitest";
import { getAvatarUrl } from "./avatar";

describe("getAvatarUrl", () => {
  it("uses the new AI avatar for unset accounts and its appended preset", () => {
    expect(getAvatarUrl(null, 26)).toContain("daily-sprout");
    expect(getAvatarUrl("preset-avatar:6", 26)).toBe(getAvatarUrl(null, 26));
  });
  it("keeps an explicit custom avatar URL", () => {
    expect(getAvatarUrl("https://example.com/avatar.png", 1)).toBe("https://example.com/avatar.png");
  });

  it("resolves preset avatars deterministically", () => {
    expect(getAvatarUrl("preset-avatar:2", 1)).toContain("grain");
    expect(getAvatarUrl(null, "same-user")).toBe(getAvatarUrl(null, "same-user"));
  });

  it("replaces legacy remote defaults with a bundled avatar", () => {
    const legacy = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80";
    expect(getAvatarUrl(legacy, 42)).not.toBe(legacy);
  });
});
