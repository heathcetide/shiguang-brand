import { calculateKeyboardInset } from "./commentComposerKeyboard";

describe("comment composer keyboard positioning", () => {
  it("uses the keyboard's actual top edge when it overlays the window", () => {
    expect(calculateKeyboardInset(800, 510)).toBe(290);
  });

  it("does not add a second offset when Android already resized the window", () => {
    expect(calculateKeyboardInset(510, 510)).toBe(0);
  });

  it("uses the independent modal bounds even when the activity has resized", () => {
    // Activity height is 510, but the translucent modal still extends to 800.
    expect(calculateKeyboardInset(800, 510)).toBe(290);
    // If the modal itself resizes, it needs no additional keyboard offset.
    expect(calculateKeyboardInset(510, 510)).toBe(0);
    // Switching to a taller emoji keyboard recalculates from the same bounds.
    expect(calculateKeyboardInset(800, 430)).toBe(370);
  });

  it("clamps stale or invalid keyboard coordinates", () => {
    expect(calculateKeyboardInset(800, -20)).toBe(800);
    expect(calculateKeyboardInset(800, 900)).toBe(0);
    expect(calculateKeyboardInset(Number.NaN, 500)).toBe(0);
  });
});
