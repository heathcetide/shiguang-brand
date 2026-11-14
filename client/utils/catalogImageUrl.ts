/** CDN keys without `/real-` are migrate-media checkerboard placeholders. */
export function isPlaceholderCatalogUrl(url?: string | null): boolean {
  if (!url) return true;
  if (!url.includes("cdn.lingecho.com") && !url.includes("/catalog/")) return false;
  if (url.includes("/real-")) return false;
  return /\/catalog\/(?:recipes|ingredients_library|kitchenware_catalog|community_posts_[^/]+)\/\d+-[a-f0-9]+/i.test(url);
}

export function usableCatalogImageUrl(url?: string | null): string | null {
  if (!url || isPlaceholderCatalogUrl(url)) return null;
  return url;
}
