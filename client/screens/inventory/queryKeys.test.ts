import { QueryClient } from "@tanstack/react-query";

import { invalidateInventoryServerState, inventoryQueryKeys, mutationInvalidationKeys } from "./queryKeys";

describe("inventory mutation cache invalidation", () => {
  it("invalidates only the active user's inventory after an inventory mutation", async () => {
    const client = new QueryClient();
    const current = inventoryQueryKeys.personal(42);
    const other = inventoryQueryKeys.personal(43);
    client.setQueryData(current, [{ id: 1 }]);
    client.setQueryData(other, [{ id: 2 }]);

    await invalidateInventoryServerState(client, "inventory", 42);

    expect(client.getQueryState(current)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("keeps inventory and kitchenware invalidation scopes independent", () => {
    expect(mutationInvalidationKeys("inventory", 7)).toEqual([inventoryQueryKeys.personal(7)]);
    expect(mutationInvalidationKeys("kitchenware", 7)).toEqual([inventoryQueryKeys.kitchenware(7)]);
  });

  it("invalidates recipe pages and their authenticated summary together", async () => {
    const client = new QueryClient();
    const catalog = inventoryQueryKeys.recipeCatalog(7, { category: "减脂" });
    const summary = inventoryQueryKeys.recipeLibrarySummary(7);
    const inventory = inventoryQueryKeys.personal(7);
    client.setQueryData(catalog, { pages: [] });
    client.setQueryData(summary, { official: 1 });
    client.setQueryData(inventory, []);

    await invalidateInventoryServerState(client, "recipe-library", 7);

    expect(client.getQueryState(catalog)?.isInvalidated).toBe(true);
    expect(client.getQueryState(summary)?.isInvalidated).toBe(true);
    expect(client.getQueryState(inventory)?.isInvalidated).toBe(false);
    client.clear();
  });
});
