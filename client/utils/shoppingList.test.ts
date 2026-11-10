import { normalizeShoppingItems } from "./shoppingList";

describe("normalizeShoppingItems", () => {
  it("normalizes legacy AI items into the shared shopping-list shape", () => {
    expect(normalizeShoppingItems([{
      id: "legacy-1",
      name: " 番茄 ",
      amount: "2个",
      addedAt: "2026-08-06",
      purchaseDate: "2026-08-07",
      storageLocation: "冷藏",
    }])).toEqual([expect.objectContaining({
      id: "legacy-1",
      name: "番茄",
      amount: "2个",
      category: "其他",
      checked: false,
      purchaseDate: "2026-08-07",
      storageLocation: "冷藏",
    })]);
  });

  it("drops invalid records instead of breaking the whole list", () => {
    expect(normalizeShoppingItems([null, { name: "" }, { name: "鸡蛋" }])).toHaveLength(1);
  });
});
