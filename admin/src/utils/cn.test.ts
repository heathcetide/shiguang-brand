import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("merges conditional classes and keeps the last Tailwind conflict", () => {
    const optionalClass = (enabled: boolean) => enabled ? "hidden" : undefined;
    expect(cn("px-2 text-sm", optionalClass(false), "px-4")).toBe("text-sm px-4");
  });
});
