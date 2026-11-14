// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestIngredientGapsMatching(t *testing.T) {
	missing := ingredientGaps(`[{"name":"牛肉"},{"name":"鸡蛋"}]`, []string{"鸡蛋", "青菜"})
	if len(missing) != 1 || missing[0] != "牛肉" {
		t.Fatalf("unexpected gaps: %v", missing)
	}
	if gaps := ingredientGaps(`["鸡蛋"]`, []string{"土鸡蛋"}); len(gaps) != 0 {
		t.Fatalf("expected contains match, got %v", gaps)
	}
}

func TestPlanMaintenanceInventoryCoverageEvaluation(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "maint_owner", "user")
		h := &Handlers{DB: db}

		missingRecipe, err := db.InsertID(`INSERT INTO recipes (title, ingredients_json) VALUES (?, ?)`,
			"缺料菜", `["牛肉","土豆","胡萝卜"]`)
		if err != nil {
			t.Fatal(err)
		}
		coveredRecipe, err := db.InsertID(`INSERT INTO recipes (title, ingredients_json) VALUES (?, ?)`,
			"现有菜", `["鸡蛋","青菜"]`)
		if err != nil {
			t.Fatal(err)
		}
		testutil.Exec(t, db, `INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, is_available)
			VALUES (?, '鸡蛋', '蛋奶', '2', '2099-12-31', 1)`, uid)
		testutil.Exec(t, db, `INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, is_available)
			VALUES (?, '青菜', '蔬菜', '1', '2099-12-31', 1)`, uid)

		planID, err := db.InsertID(`INSERT INTO meal_plans (user_id, title, status) VALUES (?, '本周', 'active')`, uid)
		if err != nil {
			t.Fatal(err)
		}
		itemID := "item-missing-1"
		if db.HasColumn("meal_plan_items", "recipe_id") {
			testutil.Exec(t, db, `INSERT INTO meal_plan_items (id, plan_id, user_id, title, recipe_id, ingredients_json, status, planned_date)
				VALUES (?, ?, ?, '晚餐', ?, '[]', 'planned', '2099-01-01')`,
				itemID, planID, uid, missingRecipe)
		} else {
			payload, _ := json.Marshal(map[string]any{"title": "晚餐", "recipe_id": missingRecipe, "ingredients": []any{}})
			testutil.Exec(t, db, `INSERT INTO meal_plan_items (id, plan_id, user_id, payload_json, status)
				VALUES (?, ?, ?, ?, 'planned')`, itemID, planID, uid, string(payload))
		}

		eval := h.evaluatePlanMaintenance(uid)
		if eval.Missing < 1 || len(eval.PendingReplacements) == 0 {
			t.Fatalf("expected missing meal with suggestion: %+v", eval)
		}
		if eval.PendingReplacements[0]["suggestedRecipeId"] != int(coveredRecipe) &&
			eval.PendingReplacements[0]["suggestedRecipeId"] != coveredRecipe {
			// JSON-free path keeps int; accept either.
			got := eval.PendingReplacements[0]["suggestedRecipeId"]
			if got != int(coveredRecipe) {
				t.Fatalf("expected suggestion %d, got %v", coveredRecipe, got)
			}
		}

		jobID := "job-1"
		past := "2020-01-01T00:00:00Z"
		testutil.Exec(t, db, `INSERT INTO plan_maintenance_jobs (id, user_id, status, attempts, available_at, created_at, updated_at)
			VALUES (?, ?, 'queued', 0, ?, ?, ?)`, jobID, uid, past, past, past)

		done := make(chan error, 1)
		go func() {
			_, err := h.RunPlanMaintenanceProcess(context.Background())
			done <- err
		}()
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("RunPlanMaintenanceProcess hung")
		}

		var status, resultRaw string
		if err := db.QueryRow(`SELECT status, COALESCE(result_json,'') FROM plan_maintenance_jobs WHERE id=?`, jobID).
			Scan(&status, &resultRaw); err != nil {
			t.Fatal(err)
		}
		if status != "completed" {
			t.Fatalf("job status=%s result=%s", status, resultRaw)
		}
		var result map[string]any
		if err := json.Unmarshal([]byte(resultRaw), &result); err != nil {
			t.Fatal(err)
		}
		pending, _ := result["pendingReplacements"].([]any)
		if len(pending) == 0 {
			t.Fatalf("expected replacement in result_json, got %s", resultRaw)
		}
	})
}
