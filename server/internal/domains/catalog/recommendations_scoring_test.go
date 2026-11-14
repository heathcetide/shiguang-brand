package catalog

import (
	"testing"
)

func TestScoreRecipesFiltersSevereAllergenAndSorts(t *testing.T) {
	recipes := []scoredRecipe{
		{ID: 1, Title: "虾仁炒蛋", IngredientsJSON: `[{"name":"虾仁"},{"name":"鸡蛋"}]`, Calories: 300, HasCalories: true, Protein: 25},
		{ID: 2, Title: "番茄炒蛋", IngredientsJSON: `[{"name":"番茄"},{"name":"鸡蛋"}]`, Calories: 280, HasCalories: true, Protein: 18},
		{ID: 3, Title: "清炒时蔬", IngredientsJSON: `[{"name":"青菜"},{"name":"蒜"}]`, Calories: 120, HasCalories: true, Protein: 4},
	}
	allergens := []allergenConstraint{{Tokens: []string{"海鲜", "虾", "蟹"}, Severity: "severe"}}
	nutrition := nutritionScoreContext{HasTarget: true, TargetCalories: 2000, Remaining: 1500, HasProteinTarget: true, TargetProtein: 90, RemainingProtein: 55}
	out := scoreRecipes([]string{"番茄", "鸡蛋"}, recipes, nil, nutrition, allergens)
	if len(out) != 2 {
		t.Fatalf("expected seafood filtered out, got %#v", out)
	}
	if out[0].Title != "番茄炒蛋" {
		t.Fatalf("expected tomato egg first by inventory+nutrition, got %#v", out)
	}
}

func TestScoreRecipesHardFiltersVeganRestriction(t *testing.T) {
	recipes := []scoredRecipe{
		{ID: 1, Title: "红烧肉", IngredientsJSON: `[{"name":"五花肉"},{"name":"酱油"}]`, Calories: 500, HasCalories: true},
		{ID: 2, Title: "蒜蓉西兰花", IngredientsJSON: `[{"name":"西兰花"},{"name":"蒜"}]`, Calories: 150, HasCalories: true},
	}
	nutrition := nutritionScoreContext{HasTarget: true, TargetCalories: 2000, Remaining: 1800, VeganStrict: true, VegetarianStrict: true}
	out := scoreRecipes(nil, recipes, nil, nutrition, nil)
	if len(out) != 1 || out[0].Title != "蒜蓉西兰花" {
		t.Fatalf("expected vegan hard filter, got %#v", out)
	}
}
