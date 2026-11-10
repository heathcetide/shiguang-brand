import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assessRecipeQuality, findRecipeQualityIssues, isCategoryFallbackNutrition } from "../src/services/recipeQuality.js";

const baseRecipe = {
  source: "wikibooks_zh",
  cookTime: 25,
  calories: 265,
  protein: 14,
  carbs: 30,
  fat: 9,
  ingredients: [{ name: "番茄", amount: "2个" }, { name: "鸡蛋", amount: "3个" }],
  steps: ["番茄切块", "炒熟鸡蛋后加入番茄"],
};

describe("imported recipe quality gate", () => {
  test("keeps structurally sound imported recipes as estimated", () => {
    assert.deepEqual(assessRecipeQuality(baseRecipe), {
      qualityStatus: "estimated",
      nutritionBasis: "ingredient_estimate",
      issues: [],
    });
  });

  test("detects the category-level fixed nutrition fallback", () => {
    const nutrition = { calories: 520, protein: 32.5, carbs: 45.5, fat: 23.1 };
    assert.equal(isCategoryFallbackNutrition(nutrition), true);
    const assessment = assessRecipeQuality({ ...baseRecipe, ...nutrition });
    assert.equal(assessment.qualityStatus, "needs_review");
    assert.equal(assessment.nutritionBasis, "category_fallback");
    assert.ok(assessment.issues.includes("category_nutrition_fallback"));
  });

  test("detects instructions imported as ingredients", () => {
    const issues = findRecipeQualityIssues({
      ...baseRecipe,
      ingredients: [{ name: "接着和面" }, { name: "煎的时候要经常翻动" }],
    });
    assert.ok(issues.includes("instruction_as_ingredient"));
  });

  test("detects truncated ingredients and implausible cooking time", () => {
    const assessment = assessRecipeQuality({
      ...baseRecipe,
      cookTime: 1,
      ingredients: [{ name: "鸡蛋以及" }, { name: "面粉" }],
    });
    assert.equal(assessment.qualityStatus, "needs_review");
    assert.ok(assessment.issues.includes("truncated_ingredient"));
    assert.ok(assessment.issues.includes("implausible_cook_time"));
  });

  test("preserves official and USDA-derived recipes as trusted", () => {
    assert.equal(assessRecipeQuality({ ...baseRecipe, source: "official" }).qualityStatus, "trusted");
    assert.equal(assessRecipeQuality({ ...baseRecipe, source: "usda_based" }).qualityStatus, "trusted");
  });
});
