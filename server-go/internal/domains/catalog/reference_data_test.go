package catalog_test

import (
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/catalog"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestFoodSearchKeepsScopedSamplesSeparateFromGenericNutrition(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		id, err := db.InsertID(`INSERT INTO ingredients_library(name,source,source_ref,quality_status,aliases_json) VALUES ('样品鸡蛋','taiwan_fda','K1','reference','["测试别名"]')`)
		if err != nil {
			t.Fatal(err)
		}
		testutil.Exec(t, db, `INSERT INTO reference_data_releases VALUES ('test','hash','https://example.test','OGDL-1.0','2026-11-11')`)
		testutil.Exec(t, db, `INSERT INTO nutrition_source_samples(dataset_id,sample_id,ingredient_id,display_name,source_kind,source_url,data_license,scope,basis,nutrients_json,payload_json)
		VALUES ('test','K1',?,'样品鸡蛋','TFDA','https://example.test','OGDL-1.0','生鸡蛋可食部','per_100g_edible_portion','{"calories":{"amount":0,"unit":"kcal"}}','{}')`, id)
		r := testutil.Router()
		(&catalog.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db)}).RegisterOn(r)
		items := testutil.Request(t, r, "GET", "/api/v1/foods/search?q=测试别名", "", nil, 200).([]any)
		if len(items) != 1 {
			t.Fatalf("items=%v", items)
		}
		item := items[0].(map[string]any)
		if item["calories_100g"] != nil || item["automatic_calculation_allowed"] != false {
			t.Fatalf("unsafe generic nutrition: %v", item)
		}
		refs := item["nutrition_references"].([]any)
		if len(refs) != 1 || refs[0].(map[string]any)["requires_scope_confirmation"] != true {
			t.Fatalf("references=%v", refs)
		}
		nutrients := refs[0].(map[string]any)["nutrients_per_100g"].(map[string]any)
		if nutrients["calories"].(map[string]any)["amount"] != float64(0) {
			t.Fatal("real zero lost")
		}
	})
}
