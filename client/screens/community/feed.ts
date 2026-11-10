import { appendUniqueItemsByKey } from "@/utils/pagination";

interface FeedItem {
  id: number;
}

const uniqueById = <T extends FeedItem>(items: T[]) =>
  appendUniqueItemsByKey([], items, (item) => item.id);

/**
 * Keep the newest posts visible after a pull-to-refresh, then rotate the
 * remaining recommendations so repeated refreshes do not reproduce the same
 * feed indefinitely when the server ranking is deterministic.
 */
export const buildRefreshedFeed = <T extends FeedItem>(
  recommended: T[] | null | undefined,
  latest: T[] | null | undefined,
  refreshSequence: number,
) => {
  const safeRecommended = Array.isArray(recommended) ? recommended : [];
  const safeLatest = Array.isArray(latest) ? latest : [];
  const newest = uniqueById(safeLatest).slice(0, 3);
  const newestIds = new Set(newest.map((item) => item.id));
  const remainingRecommended = uniqueById(safeRecommended)
    .filter((item) => !newestIds.has(item.id));
  const rotation = remainingRecommended.length
    ? ((Math.max(1, refreshSequence) - 1) * 7) % remainingRecommended.length
    : 0;
  const rotated = [
    ...remainingRecommended.slice(rotation),
    ...remainingRecommended.slice(0, rotation),
  ];

  return uniqueById([...newest, ...rotated, ...safeLatest]);
};
