// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import "testing"

func TestMergeHealthProfilePatchKeepsSiblingFields(t *testing.T) {
	current := map[string]any{
		"version":  3,
		"age":      43.0,
		"allergies": []any{map[string]any{"name": "花生", "severity": "moderate", "type": "allergy"}},
		"nutrition_targets": map[string]any{
			"calories_kcal": 1625.0,
			"protein_g":     85.0,
			"salt_g":        5.0,
		},
		"kitchen_constraints": map[string]any{
			"servings":         2.0,
			"budget_per_meal":  40.0,
			"meal_time_minutes": 45.0,
		},
	}
	patch := map[string]any{
		"version": 3.0,
		"nutrition_targets": map[string]any{
			"calories_kcal": 1800.0,
		},
		"dietary_preference": "高蛋白",
	}
	merged := mergeHealthProfilePatch(current, patch)
	if merged["age"] != 43.0 {
		t.Fatalf("age wiped: %#v", merged["age"])
	}
	if _, ok := merged["allergies"]; !ok {
		t.Fatal("allergies wiped")
	}
	targets, _ := merged["nutrition_targets"].(map[string]any)
	if targets["calories_kcal"] != 1800.0 {
		t.Fatalf("calories not patched: %#v", targets["calories_kcal"])
	}
	if targets["protein_g"] != 85.0 {
		t.Fatalf("protein sibling wiped: %#v", targets["protein_g"])
	}
	kitchen, _ := merged["kitchen_constraints"].(map[string]any)
	if kitchen["servings"] != 2.0 {
		t.Fatalf("kitchen wiped: %#v", kitchen)
	}
	if merged["dietary_preference"] != "高蛋白" {
		t.Fatalf("preference missing: %#v", merged["dietary_preference"])
	}
}
