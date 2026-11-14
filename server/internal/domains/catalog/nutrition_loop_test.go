package catalog_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/catalog"
	"github.com/heathcetide/DietDigiDose/internal/domains/lifestyle"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestDietIntakeShiftsRecommendationOrdering(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "nutrition_loop", "user")
		token := testutil.Token(t, db, uid)
		r := testutil.Router()
		auth := expressauth.New(testutil.Secret, db)
		(&catalog.Handlers{DB: db, Auth: auth}).RegisterOn(r)
		(&lifestyle.Handlers{DB: db, Auth: auth}).RegisterOn(r)

		today := time.Now().In(mustShanghai()).Format("2006-01-02")
		testutil.Exec(t, db, `INSERT INTO user_health_profiles(user_id, profile_json) VALUES (?, ?)`,
			uid, `{"nutrition_targets":{"calories_kcal":1800,"protein_g":120},"version":1}`)

		insertRecipe := func(title, summary, ingredients string, calories, protein, cook int) int64 {
			t.Helper()
			var id int64
			var err error
			if db.HasColumn("recipes", "status") {
				id, err = db.InsertID(`INSERT INTO recipes(title, summary, ingredients_json, calories, protein, cook_time_minutes, status, quality_status)
					VALUES (?,?,?,?,?,?, 'approved', 'trusted')`, title, summary, ingredients, calories, protein, cook)
			} else {
				id, err = db.InsertID(`INSERT INTO recipes(title, summary, ingredients_json, calories, protein, cook_time_minutes)
					VALUES (?,?,?,?,?,?)`, title, summary, ingredients, calories, protein, cook)
			}
			if err != nil {
				t.Fatal(err)
			}
			return id
		}
		lightID := insertRecipe("轻食沙拉", "低热量", `[{"name":"生菜","amount":"100g"},{"name":"鸡胸肉","amount":"80g"}]`, 350, 30, 15)
		heavyID := insertRecipe("红烧大荤", "高热量", `[{"name":"五花肉","amount":"200g"},{"name":"土豆","amount":"100g"}]`, 900, 25, 40)

		for _, name := range []string{"生菜", "鸡胸肉", "五花肉", "土豆"} {
			testutil.Exec(t, db, `INSERT INTO inventory_items(user_id, food_name, category, quantity, expiration_date, is_available)
				VALUES (?,?,?,?,?,1)`, uid, name, "食材", "1", "2030-01-01")
		}
		before := testutil.Request(t, r, "POST", "/api/v1/recommendations/recipes", token, map[string]any{
			"surface": "home", "pageSize": 10,
		}, 200).(map[string]any)
		beforeItems, _ := before["items"].([]any)
		if len(beforeItems) < 2 {
			t.Fatalf("expected scored recipes, got %#v", before)
		}

		testutil.Request(t, r, "POST", "/api/v1/diet-records", token, map[string]any{
			"meal_type": "午餐", "food_name": "已吃重餐", "amount": "1份",
			"calories": 1500, "protein": 40, "recorded_at": today,
		}, 201)

		after := testutil.Request(t, r, "POST", "/api/v1/recommendations/recipes", token, map[string]any{
			"surface": "home", "pageSize": 10,
		}, 200).(map[string]any)
		afterItems, _ := after["items"].([]any)
		if len(afterItems) < 2 {
			t.Fatalf("expected scored recipes after intake, got %#v", after)
		}

		findScore := func(items []any, recipeID int64) float64 {
			for _, raw := range items {
				item, _ := raw.(map[string]any)
				if int64(item["recipeId"].(float64)) == recipeID {
					return item["score"].(float64)
				}
			}
			t.Fatalf("recipe %d missing from %#v", recipeID, items)
			return 0
		}

		lightAfter := findScore(afterItems, lightID)
		heavyAfter := findScore(afterItems, heavyID)
		if lightAfter <= heavyAfter {
			t.Fatalf("after heavy intake, light recipe should outrank heavy: light=%v heavy=%v before=%#v after=%#v",
				lightAfter, heavyAfter, before["scoringVersion"], after)
		}

		listed := testutil.Request(t, r, "GET", "/api/v1/diet-records?date="+today, token, nil, 200).([]any)
		if len(listed) != 1 {
			t.Fatalf("date filter should return today's intake: %#v", listed)
		}
		row := listed[0].(map[string]any)
		if row["calories"] != float64(1500) || row["protein"] != float64(40) {
			t.Fatalf("macros not closed through list: %#v", row)
		}
		_ = fmt.Sprintf("%v", before["scoringVersion"])
	})
}

func mustShanghai() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.Local
	}
	return loc
}
