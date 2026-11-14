package lifestyle_test

import (
	"testing"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/domains/lifestyle"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestDietNutritionSummaryAggregatesShanghaiDays(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "diet_summary", "user")
		token := testutil.Token(t, db, uid)
		r := testutil.Router()
		(&lifestyle.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db), Inventory: &inventory.Service{DB: db}}).RegisterOn(r)

		today := time.Now().In(func() *time.Location {
			loc, err := time.LoadLocation("Asia/Shanghai")
			if err != nil {
				return time.Local
			}
			return loc
		}()).Format("2006-01-02")

		_ = testutil.Request(t, r, "POST", "/api/v1/diet-records", token, map[string]any{
			"meal_type": "午餐", "food_name": "汇总测试餐", "amount": "1份",
			"calories": 500, "protein": 30, "carbs": 40, "fat": 15,
			"recorded_at": today, "recorded_time": "12:00",
		}, 201)

		summary := testutil.Request(t, r, "GET", "/api/v1/diet-records/summary?days=7", token, nil, 200).(map[string]any)
		if summary["days"] != float64(7) {
			t.Fatalf("days: %#v", summary["days"])
		}
		if summary["timezone"] != "Asia/Shanghai" {
			t.Fatalf("timezone: %#v", summary["timezone"])
		}
		totals := summary["totals"].(map[string]any)
		if totals["recordCount"] != float64(1) {
			t.Fatalf("recordCount: %#v", totals)
		}
		if totals["calories"] != float64(500) || totals["protein"] != float64(30) {
			t.Fatalf("totals macros: %#v", totals)
		}
		daily := summary["daily"].([]any)
		if len(daily) != 7 {
			t.Fatalf("expected 7 daily buckets, got %d", len(daily))
		}
		found := false
		for _, item := range daily {
			day := item.(map[string]any)
			if day["date"] == today {
				found = true
				if day["calories"] != float64(500) || day["recordCount"] != float64(1) {
					t.Fatalf("today bucket: %#v", day)
				}
			}
		}
		if !found {
			t.Fatalf("today %s missing from daily: %#v", today, daily)
		}
	})
}
