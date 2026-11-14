package appapi_test

import (
	"testing"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/appapi"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestNutritionClosedLoopTargetsSummaryAndRecommendations(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		r := testutil.Router()
		appapi.Register(r, appapi.Deps{DB: db, Auth: expressauth.New(testutil.Secret, db)})
		account := map[string]any{
			"identifier": "nutrition-loop@example.test",
			"username":   "nutrition_loop",
			"password":   "NutritionLoop123!",
		}
		registered := testutil.Request(t, r, "POST", "/api/v1/auth/register", "", account, 201).(map[string]any)
		token := registered["token"].(string)

		profile := testutil.Request(t, r, "GET", "/api/v1/health-data/profile", token, nil, 200).(map[string]any)
		version := 1
		if v, ok := profile["version"].(float64); ok && int(v) > 0 {
			version = int(v)
		}
		patched := testutil.Request(t, r, "PATCH", "/api/v1/health-data/profile", token, map[string]any{
			"version": version,
			"nutrition_targets": map[string]any{
				"calories_kcal": 2000,
				"protein_g":     90,
				"carbs_g":       220,
				"fat_g":         60,
			},
			"allergies":             []any{map[string]any{"name": "海鲜", "type": "allergy", "severity": "severe"}},
			"dietary_restrictions": []any{"无麸质"},
		}, 200).(map[string]any)
		targets := patched["nutrition_targets"].(map[string]any)
		if targets["calories_kcal"] != float64(2000) || targets["carbs_g"] != float64(220) || targets["fat_g"] != float64(60) {
			t.Fatalf("targets not saved: %#v", targets)
		}

		today := time.Now().In(func() *time.Location {
			loc, err := time.LoadLocation("Asia/Shanghai")
			if err != nil {
				return time.Local
			}
			return loc
		}()).Format("2006-01-02")
		_ = testutil.Request(t, r, "POST", "/api/v1/diet-records", token, map[string]any{
			"meal_type": "午餐", "food_name": "闭环鸡胸肉", "amount": "1份",
			"calories": 500, "protein": 35, "carbs": 20, "fat": 12,
			"recorded_at": today, "recorded_time": "12:30",
		}, 201)

		summary := testutil.Request(t, r, "GET", "/api/v1/diet-records/summary?days=7", token, nil, 200).(map[string]any)
		if summary["days"] != float64(7) || summary["timezone"] != "Asia/Shanghai" {
			t.Fatalf("summary meta: %#v", summary)
		}
		totals := summary["totals"].(map[string]any)
		if totals["calories"] != float64(500) || totals["protein"] != float64(35) {
			t.Fatalf("summary totals: %#v", totals)
		}
		todayInfo := summary["today"].(map[string]any)
		if todayInfo["remainingCalories"] != float64(1500) {
			t.Fatalf("remaining calories: %#v", todayInfo)
		}
		summaryTargets := summary["targets"].(map[string]any)
		if summaryTargets["carbs_g"] != float64(220) || summaryTargets["fat_g"] != float64(60) {
			t.Fatalf("summary targets missing macros: %#v", summaryTargets)
		}

		_ = testutil.Request(t, r, "GET", "/api/v1/diet-records/summary?days=30", token, nil, 200)

		if _, err := db.Exec(`INSERT INTO recipes(title, summary, ingredients_json, calories, protein, carbs, fat)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			"番茄炒蛋", "家常菜", `[{"name":"番茄"},{"name":"鸡蛋"}]`, 280, 18, 12, 16); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO recipes(title, summary, ingredients_json, calories, protein, carbs, fat)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			"虾仁炒蛋", "海鲜", `[{"name":"虾仁"},{"name":"鸡蛋"}]`, 300, 25, 8, 14); err != nil {
			t.Fatal(err)
		}

		recs := testutil.Request(t, r, "POST", "/api/v1/recommendations/recipes", token, map[string]any{
			"surface": "home", "pageSize": 10,
		}, 200).(map[string]any)
		items, _ := recs["items"].([]any)
		for _, item := range items {
			row := item.(map[string]any)
			recipe, _ := row["recipe"].(map[string]any)
			title, _ := recipe["title"].(string)
			if title == "虾仁炒蛋" {
				t.Fatalf("severe seafood allergy still recommended: %#v", items)
			}
		}

		testutil.Request(t, r, "DELETE", "/api/v1/auth/account", token, map[string]any{
			"password": "NutritionLoop123!", "confirmation": "DELETE",
		}, 200)
	})
}
