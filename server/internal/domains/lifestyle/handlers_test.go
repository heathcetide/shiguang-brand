package lifestyle_test

import (
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/domains/lifestyle"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"testing"
)

func TestProfilesUpsertAndCookingOwnership(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "lifestyle", "user")
		other := testutil.User(t, db, "lifestyle_other", "user")
		token := testutil.Token(t, db, uid)
		ot := testutil.Token(t, db, other)
		r := testutil.Router()
		(&lifestyle.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db), Inventory: &inventory.Service{DB: db}}).RegisterOn(r)
		for _, weight := range []int{60, 65} {
			testutil.Request(t, r, "PUT", "/api/v1/health-data/profile", token, map[string]any{"weight": weight}, 200)
		}
		profile := testutil.Request(t, r, "GET", "/api/v1/health-data/profile", token, nil, 200).(map[string]any)
		if profile["weight"] != float64(65) || testutil.Count(t, db, "user_health_profiles") != 1 {
			t.Fatalf("profile upsert failed: %v", profile)
		}
		foreign := testutil.Request(t, r, "GET", "/api/v1/health-data/profile", ot, nil, 200).(map[string]any)
		if foreign["weight"] != nil {
			t.Fatal("another user's profile disclosed")
		}
		for i := 0; i < 2; i++ {
			testutil.Request(t, r, "POST", "/api/v1/onboarding", token, map[string]any{"completed": true}, 200)
		}
		if testutil.Count(t, db, "user_onboarding") != 1 {
			t.Fatal("onboarding upsert duplicated")
		}
		rid, err := db.InsertID(`INSERT INTO recipes(title) VALUES (?)`, "队列菜谱")
		if err != nil {
			t.Fatal(err)
		}
		queued := testutil.Request(t, r, "POST", "/api/v1/cooking-queue", token, map[string]any{"recipe_id": rid}, 201).(map[string]any)
		id := queued["item"].(map[string]any)["id"].(string)
		testutil.Request(t, r, "DELETE", "/api/v1/cooking-queue/"+id, ot, nil, 200)
		rows := testutil.Request(t, r, "GET", "/api/v1/cooking-queue", token, nil, 200).([]any)
		if len(rows) != 1 {
			t.Fatal("another account deleted the queue item")
		}
		testutil.Request(t, r, "DELETE", "/api/v1/cooking-queue/"+id, token, nil, 200)
		if testutil.Count(t, db, "cooking_queue_items") != 0 {
			t.Fatal("queue item not removed")
		}
	})
}
