package inventory_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestInventoryIsolationConsumptionAndRollback(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		owner := testutil.User(t, db, "owner", "user")
		other := testutil.User(t, db, "other", "user")
		s := inventory.Service{DB: db}
		item, err := s.Create(owner, map[string]any{"food_name": "西红柿", "category": "蔬菜", "quantity": "100g", "quantity_value": 100.0, "quantity_unit": "g", "expiration_date": "2030-01-01"})
		if err != nil {
			t.Fatal(err)
		}
		id := item["id"]
		if list, err := s.List(other); err != nil || len(list) != 0 {
			t.Fatalf("cross-account list: %v %v", list, err)
		}
		line := map[string]any{"item_id": id, "version": 1.0, "mode": "amount", "amount_value": 25.0, "unit": "g"}
		if _, err := s.Consume(other, map[string]any{"idempotency_key": "foreign", "items": []any{line}}); err == nil {
			t.Fatal("foreign item consumed")
		}
		body := map[string]any{"idempotency_key": "consume-once", "items": []any{line}}
		if _, err := s.Consume(owner, body); err != nil {
			t.Fatal(err)
		}
		repeated, err := s.Consume(owner, body)
		if err != nil || repeated["repeated"] != true {
			t.Fatalf("idempotent retry: %v %v", repeated, err)
		}
		body["idempotency_key"] = "stale"
		_, err = s.Consume(owner, body)
		var apiErr *inventory.APIError
		if !errors.As(err, &apiErr) || apiErr.Status != 409 {
			t.Fatalf("stale version accepted: %v", err)
		}
		line["version"] = 2.0
		_, err = s.Consume(owner, map[string]any{"idempotency_key": "rollback", "items": []any{line, map[string]any{"item_id": -1.0, "version": 1.0, "mode": "all"}}})
		if err == nil {
			t.Fatal("invalid multi-item consumption accepted")
		}
		var quantity float64
		var version int
		if err := db.QueryRow(`SELECT quantity_value,version FROM inventory_items WHERE id=?`, id).Scan(&quantity, &version); err != nil {
			t.Fatal(err)
		}
		if quantity != 75 || version != 2 {
			t.Fatalf("duplicate/failed consumption mutated stock: %g v%d", quantity, version)
		}
		if n := testutil.Count(t, db, "inventory_consumption_requests"); n != 1 {
			t.Fatalf("request count=%d", n)
		}
	})
}

func TestBulkIntakeRequiresConfirmationAndDeduplicates(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "intake", "user")
		s := inventory.Service{DB: db}
		entry := map[string]any{"food_name": "鸡蛋", "category": "蛋类", "quantity": "2个", "quantity_value": 2.0, "quantity_unit": "个", "confirmed": false}
		body := map[string]any{"idempotency_key": "intake-1", "source": "manual", "items": []any{entry}}
		if _, err := s.BulkIntake(uid, body); err == nil {
			t.Fatal("unconfirmed intake accepted")
		}
		if n := testutil.Count(t, db, "inventory_items"); n != 0 {
			t.Fatal("failed intake left rows")
		}
		entry["confirmed"] = true
		first, err := s.BulkIntake(uid, body)
		if err != nil {
			t.Fatal(err)
		}
		again, err := s.BulkIntake(uid, body)
		if err != nil {
			t.Fatal(err)
		}
		if again["repeated"] != true || fmt.Sprint(first["batch_id"]) != fmt.Sprint(again["batch_id"]) || testutil.Count(t, db, "inventory_items") != 1 {
			t.Fatalf("intake repeated writes: %v", again)
		}
	})
}
