import { getHorizontalSwipeDirection } from "./carousel";

describe("home recommendation carousel gestures", () => {
  it("maps deliberate horizontal swipes to the adjacent card", () => {
    expect(getHorizontalSwipeDirection(-80, 12)).toBe("next");
    expect(getHorizontalSwipeDirection(80, -12)).toBe("prev");
  });

  it("leaves taps and vertical page scrolling to their existing handlers", () => {
    expect(getHorizontalSwipeDirection(12, 2)).toBeNull();
    expect(getHorizontalSwipeDirection(70, 100)).toBeNull();
    expect(getHorizontalSwipeDirection(Number.NaN, 0)).toBeNull();
  });
});
