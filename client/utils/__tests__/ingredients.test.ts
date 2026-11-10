import { ingredientNamesMatch, normalizeIngredientName } from "../ingredients";

describe("ingredient matching", () => {
  it("normalizes common Chinese aliases and quantity suffixes", () => {
    expect(normalizeIngredientName("新鲜西红柿 200g")).toBe("番茄");
    expect(ingredientNamesMatch("番茄", "樱桃小番茄 1盒")).toBe(true);
    expect(ingredientNamesMatch("鸡胸肉 160g", "谷物养殖鸡胸肉")).toBe(true);
  });

  it("does not match unrelated ingredients", () => {
    expect(ingredientNamesMatch("西兰花", "鸡胸肉")).toBe(false);
  });
});
