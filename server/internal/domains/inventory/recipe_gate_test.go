package inventory_test

import (
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestReferenceRecipeCannotDriveInventoryWrites(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		id, err := db.InsertID(`INSERT INTO recipes(title,automatic_inventory_write_allowed) VALUES ('未审核参考',0)`)
		if err != nil {
			t.Fatal(err)
		}
		if err := inventory.CheckRecipeExecution(db, int(id)); err == nil {
			t.Fatal("reference recipe execution allowed")
		}
		_, err = (&inventory.Service{DB: db}).Consume(1, map[string]any{"recipe_id": float64(id), "idempotency_key": "ref-test", "items": []any{}})
		apiErr, ok := err.(*inventory.APIError)
		if !ok || apiErr.Code != "RECIPE_EXECUTION_NOT_ALLOWED" {
			t.Fatalf("wrong error: %v", err)
		}
		testutil.Exec(t, db, `UPDATE recipes SET automatic_inventory_write_allowed=1 WHERE id=?`, id)
		if err := inventory.CheckRecipeExecution(db, int(id)); err != nil {
			t.Fatal(err)
		}
		if err := inventory.CheckRecipeExecution(db, int(id)+1); err == nil {
			t.Fatal("missing recipe accepted")
		}
	})
}
