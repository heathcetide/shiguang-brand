package catalog_test

import (
	"fmt"
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/catalog"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestFavoritesAndShoppingOnBothDatabases(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		owner := testutil.User(t, db, "catalog_owner", "user")
		other := testutil.User(t, db, "catalog_other", "user")
		token := testutil.Token(t, db, owner)
		otherToken := testutil.Token(t, db, other)
		r := testutil.Router()
		(&catalog.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db)}).RegisterOn(r)
		rid, err := db.InsertID(`INSERT INTO recipes(title) VALUES (?)`, "测试菜谱")
		if err != nil {
			t.Fatal(err)
		}
		favorite := fmt.Sprintf("/api/v1/recipes/%d/favorite", rid)
		testutil.Request(t, r, "POST", favorite, "", nil, 401)
		testutil.Request(t, r, "POST", favorite, token, nil, 200)
		testutil.Request(t, r, "POST", favorite, token, nil, 200)
		if n := testutil.Count(t, db, "recipe_favorites"); n != 1 {
			t.Fatalf("duplicate favorites: %d", n)
		}
		testutil.Request(t, r, "DELETE", favorite, otherToken, nil, 200)
		if n := testutil.Count(t, db, "recipe_favorites"); n != 1 {
			t.Fatal("foreign favorite removed")
		}
		testutil.Request(t, r, "DELETE", favorite, token, nil, 200)
		if n := testutil.Count(t, db, "recipe_favorites"); n != 0 {
			t.Fatal("favorite not removed")
		}
		item := testutil.Request(t, r, "POST", "/api/v1/shopping-list", token, map[string]any{"name": "西红柿", "amount": "2个"}, 201).(map[string]any)
		id, ok := item["id"].(string)
		if !ok || id == "" {
			t.Fatalf("shopping id is not a UUID: %v", item)
		}
		path := "/api/v1/shopping-list/" + id
		testutil.Request(t, r, "PUT", path, otherToken, map[string]any{"checked": true, "version": 1}, 409)
		testutil.Request(t, r, "PUT", path, token, map[string]any{"checked": true, "version": 1}, 200)
		rows := testutil.Request(t, r, "GET", "/api/v1/shopping-list", token, nil, 200).([]any)
		if len(rows) != 1 || rows[0].(map[string]any)["checked"] != true {
			t.Fatalf("shopping update: %v", rows)
		}
		testutil.Request(t, r, "DELETE", path, token, nil, 200)
		if rows := testutil.Request(t, r, "GET", "/api/v1/shopping-list", token, nil, 200).([]any); len(rows) != 0 {
			t.Fatal("deleted shopping item visible")
		}
	})
}
