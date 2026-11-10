export function appendUniqueItemsByKey<T>(
  current: readonly T[],
  incoming: readonly T[],
  getKey: (item: T) => string | number,
) {
  const seen = new Set(current.map(getKey));
  const appended = incoming.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...appended];
}
