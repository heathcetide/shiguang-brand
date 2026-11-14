package lifestyle_test

import (
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/domains/lifestyle"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestDietCreateListRoundTripMacrosAndDateFilter(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "diet_loop", "user")
		token := testutil.Token(t, db, uid)
		r := testutil.Router()
		(&lifestyle.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db), Inventory: &inventory.Service{DB: db}}).RegisterOn(r)

		created := testutil.Request(t, r, "POST", "/api/v1/diet-records", token, map[string]any{
			"meal_type": "午餐", "food_name": "鸡胸肉沙拉", "amount": "1份",
			"calories": 420, "protein": 35, "carbs": 18, "fat": 12,
			"recorded_at": "2026-11-14", "recorded_time": "12:30",
		}, 201).(map[string]any)
		if created["food_name"] != "鸡胸肉沙拉" {
			t.Fatalf("create response: %#v", created)
		}
		if created["protein"] != float64(35) || created["carbs"] != float64(18) || created["fat"] != float64(12) {
			t.Fatalf("macros not returned: %#v", created)
		}

		today := testutil.Request(t, r, "GET", "/api/v1/diet-records?date=2026-11-14", token, nil, 200).([]any)
		if len(today) != 1 {
			t.Fatalf("expected 1 today record, got %#v", today)
		}
		row := today[0].(map[string]any)
		if row["calories"] != float64(420) || row["protein"] != float64(35) {
			t.Fatalf("list macros missing: %#v", row)
		}
		if row["recorded_time"] != "12:30" {
			t.Fatalf("recorded_time missing: %#v", row)
		}

		other := testutil.Request(t, r, "GET", "/api/v1/diet-records?date=2026-11-13", token, nil, 200).([]any)
		if len(other) != 0 {
			t.Fatalf("date filter failed: %#v", other)
		}

		first := testutil.Request(t, r, "POST", "/api/v1/diet-records", token, map[string]any{
			"meal_type": "晚餐", "food_name": "幂等餐", "amount": "1份", "calories": 100,
			"recorded_at": "2026-11-14", "idempotency_key": "11111111-1111-4111-8111-111111111111",
		}, 201).(map[string]any)
		second := testutil.Request(t, r, "POST", "/api/v1/diet-records", token, map[string]any{
			"meal_type": "晚餐", "food_name": "幂等餐", "amount": "1份", "calories": 100,
			"recorded_at": "2026-11-14", "idempotency_key": "11111111-1111-4111-8111-111111111111",
		}, 200).(map[string]any)
		if first["id"] != second["id"] || second["repeated"] != true {
			t.Fatalf("diet idempotency failed: first=%#v second=%#v", first, second)
		}
		todayAgain := testutil.Request(t, r, "GET", "/api/v1/diet-records?date=2026-11-14", token, nil, 200).([]any)
		if len(todayAgain) != 2 {
			t.Fatalf("expected original + one idempotent meal, got %d: %#v", len(todayAgain), todayAgain)
		}
	})
}
