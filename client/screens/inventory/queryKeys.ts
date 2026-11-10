import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { RecipeCatalogQuery } from "./useInventoryData";

export const inventoryQueryKeys = {
  all: ["inventory-feature"] as const,
  personal: (userId?: number | null) => ["inventory-feature", "personal", userId ?? "anonymous"] as const,
  kitchenware: (userId?: number | null) => ["inventory-feature", "kitchenware", userId ?? "anonymous"] as const,
  kitchenwareCatalog: ["inventory-feature", "kitchenware-catalog"] as const,
  recipeCatalog: (userId: number | null | undefined, query: RecipeCatalogQuery) => [
    "inventory-feature",
    "recipes",
    userId ?? "anonymous",
    query.category ?? "",
    query.search ?? "",
    query.maxCookTime ?? 0,
    query.scope ?? "all",
  ] as const,
  recipeLibrarySummary: (userId?: number | null) => ["inventory-feature", "recipe-library-summary", userId ?? "anonymous"] as const,
};

export type InventoryMutationKind = "inventory" | "kitchenware" | "recipe-library";

export function mutationInvalidationKeys(kind: InventoryMutationKind, userId?: number | null): QueryKey[] {
  if (kind === "inventory") return [inventoryQueryKeys.personal(userId)];
  if (kind === "kitchenware") return [inventoryQueryKeys.kitchenware(userId)];
  return [inventoryQueryKeys.recipeLibrarySummary(userId), ["inventory-feature", "recipes"]];
}

export async function invalidateInventoryServerState(
  queryClient: QueryClient,
  kind: InventoryMutationKind,
  userId?: number | null,
) {
  await Promise.all(mutationInvalidationKeys(kind, userId).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
