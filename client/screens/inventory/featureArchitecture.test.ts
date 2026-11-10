import { readFileSync } from "node:fs";
import path from "node:path";

const read = (name: string) => readFileSync(path.resolve(__dirname, name), "utf8");

describe("inventory feature boundaries", () => {
  it("keeps the screen as a composition layer instead of a direct inventory transport client", () => {
    const screen = read("index.tsx");
    expect(screen).toContain("useInventoryData");
    expect(screen).toContain("useInventoryMutations");
    expect(screen).toContain("<InventoryEntryForm");
    expect(screen).toContain("<KitchenwareSection");
    expect(screen).not.toMatch(/inventoryApi\.|kitchenwareApi\./);
    expect(screen.split("\n").length).toBeLessThan(2_700);
  });

  it("keeps server-state and invalidation policy inside feature hooks", () => {
    const reads = read("useInventoryData.ts");
    const writes = read("useInventoryMutations.ts");
    expect(reads).toContain("useInfiniteQuery");
    expect(reads).toContain("useQuery");
    expect(writes).toContain("invalidateInventoryServerState");
    expect(writes).toContain("useMutation");
  });
});
