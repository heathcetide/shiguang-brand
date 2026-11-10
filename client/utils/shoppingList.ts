export type ShoppingItem = {
  id: string;
  name: string;
  amount: string;
  category: string;
  checked: boolean;
  createdAt: number;
  purchaseDate?: string;
  storageLocation?: string;
  clientId?: string;
  version?: number;
};

export function normalizeShoppingItems(value: unknown): ShoppingItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return [];
    const parsedCreatedAt = typeof item.createdAt === "number"
      ? item.createdAt
      : typeof item.createdAt === "string"
        ? Date.parse(item.createdAt)
      : typeof item.addedAt === "string"
        ? Date.parse(item.addedAt)
        : Number.NaN;

    const purchaseDate = typeof item.purchaseDate === "string" && item.purchaseDate.trim()
      ? item.purchaseDate.trim()
      : undefined;

    const storageLocation = typeof item.storageLocation === "string" && item.storageLocation.trim()
      ? item.storageLocation.trim()
      : undefined;

    return [{
      id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${index}`,
      name,
      amount: typeof item.amount === "string" && item.amount.trim() ? item.amount.trim() : "适量",
      category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : "其他",
      checked: item.checked === true,
      createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now(),
      purchaseDate,
      storageLocation,
      clientId: typeof item.clientId === "string" ? item.clientId : undefined,
      version: typeof item.version === "number" && Number.isFinite(item.version) ? item.version : undefined,
    }];
  });
}
