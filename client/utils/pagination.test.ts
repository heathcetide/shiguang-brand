import { appendUniqueItemsByKey } from "./pagination";

describe("appendUniqueItemsByKey", () => {
  it("keeps every existing item in place and appends only unseen next-page items", () => {
    const current = [{ id: 9 }, { id: 7 }, { id: 5 }];
    const incoming = [{ id: 7 }, { id: 4 }, { id: 3 }, { id: 4 }];

    expect(appendUniqueItemsByKey(current, incoming, (item) => item.id))
      .toEqual([{ id: 9 }, { id: 7 }, { id: 5 }, { id: 4 }, { id: 3 }]);
    expect(current).toEqual([{ id: 9 }, { id: 7 }, { id: 5 }]);
  });

  it("supports recommendation pages keyed by recipeId", () => {
    const current = [{ recipeId: 2, score: 10 }, { recipeId: 1, score: 9 }];
    const incoming = [{ recipeId: 1, score: 12 }, { recipeId: 3, score: 8 }];

    expect(appendUniqueItemsByKey(current, incoming, (item) => item.recipeId))
      .toEqual([{ recipeId: 2, score: 10 }, { recipeId: 1, score: 9 }, { recipeId: 3, score: 8 }]);
  });
});
