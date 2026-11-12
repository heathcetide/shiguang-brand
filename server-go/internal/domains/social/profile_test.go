package social_test

import (
	"fmt"
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/social"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestCommunityProfileContractAndFollow(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		viewer := testutil.User(t, db, "profile_viewer", "user")
		author := testutil.User(t, db, "profile_author", "user")
		empty := testutil.User(t, db, "profile_empty", "user")
		token := testutil.Token(t, db, viewer)
		r := testutil.Router()
		(&social.Handlers{DB: db, Auth: expressauth.New(testutil.Secret, db)}).RegisterOn(r)
		for i := 0; i < 22; i++ {
			testutil.Exec(t, db, `INSERT INTO community_posts(user_id, content, created_at) VALUES (?,?,?)`, author, fmt.Sprintf("post %d", i), "2026-11-11 00:00:00")
		}
		testutil.Exec(t, db, `INSERT INTO community_follows(follower_id,followed_id) VALUES (?,?)`, author, empty)
		path := fmt.Sprintf("/api/v1/community/users/%d/profile", author)
		profile := testutil.Request(t, r, "GET", path, "", nil, 200).(map[string]any)
		if profile["posts_count"] != float64(22) || profile["followers_count"] != float64(0) || profile["following_count"] != float64(1) {
			t.Fatalf("wrong counts: %v", profile)
		}
		if profile["is_following"] != false || profile["following"] != false {
			t.Fatalf("anonymous follow state: %v", profile)
		}
		if level, present := profile["level"]; !present || level != nil {
			t.Fatal("unmigrated growth level must be explicitly unavailable, not invented")
		}
		posts := profile["posts"].([]any)
		if len(posts) != 20 || posts[0].(map[string]any)["content"] != "post 21" {
			t.Fatalf("posts must be bounded and newest-first: %v", posts)
		}
		firstID := int(posts[0].(map[string]any)["id"].(float64))
		testutil.Exec(t, db, `INSERT INTO community_post_likes(post_id,user_id) VALUES (?,?)`, firstID, viewer)
		followPath := fmt.Sprintf("/api/v1/community/users/%d/follow", author)
		follow := testutil.Request(t, r, "POST", followPath, token, nil, 200).(map[string]any)
		if follow["following"] != true || follow["is_following"] != true || follow["following_count"] != float64(1) {
			t.Fatalf("follow response contract: %v", follow)
		}
		profile = testutil.Request(t, r, "GET", path, token, nil, 200).(map[string]any)
		if profile["is_following"] != true || profile["followers_count"] != float64(1) || profile["posts"].([]any)[0].(map[string]any)["likes_count"] != float64(1) {
			t.Fatalf("viewer-aware profile: %v", profile)
		}
		unfollow := testutil.Request(t, r, "POST", followPath, token, nil, 200).(map[string]any)
		if unfollow["is_following"] != false || unfollow["following"] != false || unfollow["following_count"] != float64(0) {
			t.Fatalf("unfollow response contract: %v", unfollow)
		}
		profile = testutil.Request(t, r, "GET", fmt.Sprintf("/api/v1/community/users/%d/profile", empty), "", nil, 200).(map[string]any)
		if profile["posts_count"] != float64(0) || len(profile["posts"].([]any)) != 0 {
			t.Fatalf("empty profile requires an empty array: %v", profile)
		}
		testutil.Request(t, r, "GET", "/api/v1/community/users/999999/profile", "", nil, 404)
	})
}
