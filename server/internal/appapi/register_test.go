package appapi_test

import (
	"github.com/heathcetide/DietDigiDose/internal/appapi"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"testing"
)

// Exercise the actual shared router, not Express or stub domain handlers.
func TestCookingToActualIntakeCoreLoop(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		r := testutil.Router()
		appapi.Register(r, appapi.Deps{DB: db, Auth: expressauth.New(testutil.Secret, db)})
		account := map[string]any{"identifier": "core-loop@example.test", "username": "core_loop", "password": "CoreLoop123!"}
		registered := testutil.Request(t, r, "POST", "/api/v1/auth/register", "", account, 201).(map[string]any)
		token := registered["token"].(string)
		item := testutil.Request(t, r, "POST", "/api/v1/inventory", token, map[string]any{"food_name": "番茄", "category": "蔬菜", "quantity": "2个", "quantity_value": 2, "quantity_unit": "piece", "expiration_date": "2030-01-01"}, 201).(map[string]any)
		input := map[string]any{"idempotency_key": "core-production", "inventory_consumptions": []any{map[string]any{"item_id": item["id"], "version": 1, "mode": "amount", "amount_value": 1, "unit": "piece"}}, "production": map[string]any{"food_name": "测试备餐", "produced_servings": 2, "eaten_servings": 0}}
		made := testutil.Request(t, r, "POST", "/api/v1/diet-records/cooking-completions", token, input, 201).(map[string]any)
		meal := made["prepared_meal"].(map[string]any)
		if made["diet_record"] != nil || meal["remaining_servings"] != float64(2) {
			t.Fatalf("production fabricated intake: %v", made)
		}
		retry := testutil.Request(t, r, "POST", "/api/v1/diet-records/cooking-completions", token, input, 200).(map[string]any)
		if retry["repeated"] != true {
			t.Fatal("production retry was not idempotent")
		}
		path := "/api/v1/diet-records/prepared-meals/" + meal["id"].(string) + "/events"
		eat := map[string]any{"idempotency_key": "core-eat", "version": 1, "type": "eat", "servings": 0.5, "meal_type": "午餐", "recorded_at": "2026-11-10"}
		eaten := testutil.Request(t, r, "POST", path, token, eat, 201).(map[string]any)
		record := eaten["diet_record"].(map[string]any)
		if record["amount"] != "0.5份" || record["calories"] != nil {
			t.Fatalf("intake amount/unknown nutrition changed: %v", record)
		}
		testutil.Request(t, r, "POST", path, token, eat, 200)
		discarded := testutil.Request(t, r, "POST", path, token, map[string]any{"idempotency_key": "core-discard", "version": 2, "type": "discard", "servings": 1.5}, 201).(map[string]any)
		if discarded["diet_record"] != nil {
			t.Fatal("discard fabricated intake")
		}
		testutil.Request(t, r, "POST", "/api/v1/diet-records/cooking-completions", token, input, 200)
		meals := testutil.Request(t, r, "GET", "/api/v1/diet-records/prepared-meals", token, nil, 200).([]any)
		if len(meals) != 1 || meals[0].(map[string]any)["remaining_servings"] != float64(0) {
			t.Fatalf("old retry restored servings: %v", meals)
		}
		records := testutil.Request(t, r, "GET", "/api/v1/diet-records", token, nil, 200).([]any)
		if len(records) != 1 || records[0].(map[string]any)["calories"] != nil {
			t.Fatalf("intake duplicated or nutrition fabricated: %v", records)
		}
		stock := testutil.Request(t, r, "GET", "/api/v1/inventory", token, nil, 200).([]any)
		if len(stock) != 1 || stock[0].(map[string]any)["quantity_value"] != float64(1) {
			t.Fatalf("stock deducted more than once: %v", stock)
		}
		testutil.Request(t, r, "DELETE", "/api/v1/auth/account", token, map[string]any{"password": "CoreLoop123!", "confirmation": "DELETE"}, 200)
		if testutil.Count(t, db, "users") != 0 {
			t.Fatal("account cleanup did not remove synthetic account")
		}
	})
}
