export type CarouselDirection = "prev" | "next";

export function getHorizontalSwipeDirection(
  deltaX: number,
  deltaY: number,
  threshold = 44,
): CarouselDirection | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return null;
  return deltaX < 0 ? "next" : "prev";
}
