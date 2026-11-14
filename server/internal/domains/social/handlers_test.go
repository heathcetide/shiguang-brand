package social_test

import (
	"fmt"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/social"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"testing"
)

func TestHouseholdMembershipAndCheckinDeduplication(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "household_owner", "user")
		other := testutil.User(t, db, "household_member", "user")
		token := testutil.Token(t, db, uid)
		ot := testutil.Token(t, db, other)
		r := testutil.Router()
		(&social.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db)}).RegisterOn(r)
		hh := testutil.Request(t, r, "POST", "/api/v1/households", token, map[string]any{"name": "测试家庭"}, 201).(map[string]any)
		code := hh["invite_code"].(string)
		joined := testutil.Request(t, r, "POST", "/api/v1/households/join", ot, map[string]any{"invite_code": code}, 200).(map[string]any)
		if joined["kind"] != "joined" {
			t.Fatalf("join failed: %v", joined)
		}
		again := testutil.Request(t, r, "POST", "/api/v1/households/join", ot, map[string]any{"invite_code": code}, 200).(map[string]any)
		if again["kind"] != "existing" || testutil.Count(t, db, "household_members") != 2 {
			t.Fatal("membership duplicated")
		}
		mine := testutil.Request(t, r, "GET", "/api/v1/households/mine", ot, nil, 200).([]any)
		if len(mine) != 1 || len(mine[0].(map[string]any)["members"].([]any)) != 2 {
			t.Fatalf("membership query failed: %v", mine)
		}
		path := fmt.Sprintf("/api/v1/households/%.0f/leave", hh["id"])
		testutil.Request(t, r, "POST", path, ot, nil, 200)
		if testutil.Count(t, db, "household_members") != 1 {
			t.Fatal("membership not removed")
		}
		testutil.Request(t, r, "POST", "/api/v1/community/check-in", token, nil, 201)
		retry := testutil.Request(t, r, "POST", "/api/v1/community/check-in", token, nil, 200).(map[string]any)
		if retry["created"] != false || retry["checkedIn"] != true || testutil.Count(t, db, "community_checkins") != 1 {
			t.Fatalf("check-in repeated: %v", retry)
		}
	})
}
