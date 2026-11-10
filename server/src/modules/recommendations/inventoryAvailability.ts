import type { Row } from "./types.js";

/** Unknown expiry stays unknown; explicitly expired stock cannot cover cooking demand. */
export function unexpiredInventory(items: Row[], date: string) {
  return items.filter(item => {
    const expiry = typeof item.expiration_date === "string" ? item.expiration_date : "";
    return !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || expiry >= date;
  });
}
