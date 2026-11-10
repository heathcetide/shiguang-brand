import {
  COMMON_INGREDIENTS,
  inferCategoryByName,
  inferIngredientDefaults,
  inferShelfLifeDays,
  searchCommonIngredients,
} from "../ingredientRules";

describe("ingredientRules", () => {
  test("inferCategoryByName maps ingredients to correct categories", () => {
    expect(inferCategoryByName("五花肉")).toBe("肉食");
    expect(inferCategoryByName("三文鱼")).toBe("水产海鲜");
    expect(inferCategoryByName("鲜牛奶")).toBe("乳制品");
    expect(inferCategoryByName("红富士苹果")).toBe("水果");
    expect(inferCategoryByName("海天酱油")).toBe("调味品");
    expect(inferCategoryByName("东北大米")).toBe("粮油干货");
    expect(inferCategoryByName("猪肉水饺")).toBe("熟食面点");
    expect(inferCategoryByName("大白菜")).toBe("蔬菜");
  });

  test("inferShelfLifeDays accounts for storage location", () => {
    expect(inferShelfLifeDays("猪肉", "冷冻")).toBe(180);
    expect(inferShelfLifeDays("猪肉", "冷藏")).toBe(3);
    expect(inferShelfLifeDays("鸡蛋", "冷藏")).toBe(30);
    expect(inferShelfLifeDays("生菜", "冷藏")).toBe(4);
    expect(inferShelfLifeDays("大米", "常温")).toBe(180);
  });

  test("inferIngredientDefaults returns defaults for exact and unmatched names", () => {
    const eggDefaults = inferIngredientDefaults("鸡蛋");
    expect(eggDefaults.category).toBe("乳制品");
    expect(eggDefaults.storageLocation).toBe("冷藏");
    expect(eggDefaults.shelfLifeDays).toBe(30);
    expect(eggDefaults.defaultQuantity).toBe("10个");

    const customDefaults = inferIngredientDefaults("小农女无花果");
    expect(customDefaults.category).toBe("水果");
    expect(customDefaults.storageLocation).toBe("常温");
    expect(customDefaults.shelfLifeDays).toBe(14);
  });

  test("searchCommonIngredients filters correctly", () => {
    const results = searchCommonIngredients("肉");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((item) => item.name.includes("肉"))).toBe(true);

    const emptySearch = searchCommonIngredients("");
    expect(emptySearch.length).toBe(10);
  });
});
