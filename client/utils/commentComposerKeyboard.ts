// Use the full-screen translucent Modal's own layout height. Android may resize
// the activity window independently, so useWindowDimensions is not its boundary.
export function calculateKeyboardInset(viewportHeight: number, keyboardTop: number) {
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(keyboardTop) || viewportHeight <= 0) return 0;
  return Math.max(0, Math.min(viewportHeight, viewportHeight - keyboardTop));
}
