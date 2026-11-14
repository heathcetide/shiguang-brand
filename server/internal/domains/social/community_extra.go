// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) CommunityCheckInGet(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	key := todayDateKey()
	var created string
	err := h.DB.QueryRow(`SELECT COALESCE(created_at,'') FROM community_checkins WHERE user_id=? AND date_key=?`, userID, key).Scan(&created)
	c.JSON(http.StatusOK, gin.H{"dateKey": key, "checkedIn": err == nil, "checkedInAt": emptyNil(created)})
}

func (h *Handlers) CommunityCheckInPost(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	key := todayDateKey()
	res, err := h.DB.Exec(`INSERT INTO community_checkins (user_id, date_key) VALUES (?, ?) ON CONFLICT DO NOTHING`, userID, key)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "签到失败", "CHECKIN_FAILED")
		return
	}
	n, _ := res.RowsAffected()
	status := http.StatusCreated
	if n == 0 {
		status = http.StatusOK
	}
	streak := h.communityCheckInStreak(userID)
	c.JSON(status, gin.H{"dateKey": key, "checkedIn": true, "streak": streak, "created": n == 1})
}

func (h *Handlers) communityCheckInStreak(userID int) int {
	rows, err := h.DB.Query(`SELECT date_key FROM community_checkins WHERE user_id=? ORDER BY date_key DESC LIMIT 400`, userID)
	if err != nil {
		return 1
	}
	defer rows.Close()
	dates := make([]string, 0)
	for rows.Next() {
		var key string
		if rows.Scan(&key) == nil && key != "" {
			dates = append(dates, key)
		}
	}
	if len(dates) == 0 {
		return 0
	}
	loc, _ := time.LoadLocation("Asia/Shanghai")
	anchor := time.Now().In(loc)
	anchorKey := anchor.Format("2006-01-02")
	yesterdayKey := anchor.AddDate(0, 0, -1).Format("2006-01-02")
	if dates[0] != anchorKey && dates[0] != yesterdayKey {
		return 0
	}
	streak := 0
	expect := dates[0]
	for _, key := range dates {
		if key != expect {
			break
		}
		streak++
		t, parseErr := time.ParseInLocation("2006-01-02", key, loc)
		if parseErr != nil {
			break
		}
		expect = t.AddDate(0, 0, -1).Format("2006-01-02")
	}
	return streak
}

func (h *Handlers) CommunityFollowing(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT u.id, u.username, COALESCE(u.nickname,u.username), u.avatar_url, cf.created_at
		FROM community_follows cf JOIN users u ON u.id=cf.followed_id WHERE cf.follower_id=? ORDER BY cf.created_at DESC`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := h.scanUserRows(rows)
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CommunityUserFollowing(c *gin.Context) {
	targetID, err := strconv.Atoi(c.Param("id"))
	if err != nil || targetID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	rows, err := h.DB.Query(`SELECT u.id, u.username, COALESCE(u.nickname,u.username), u.avatar_url, cf.created_at
		FROM community_follows cf JOIN users u ON u.id=cf.followed_id WHERE cf.follower_id=? ORDER BY cf.created_at DESC`, targetID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	c.JSON(http.StatusOK, h.scanUserRows(rows))
}

func (h *Handlers) CommunityUserFollowers(c *gin.Context) {
	targetID, err := strconv.Atoi(c.Param("id"))
	if err != nil || targetID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	rows, err := h.DB.Query(`SELECT u.id, u.username, COALESCE(u.nickname,u.username), u.avatar_url, cf.created_at
		FROM community_follows cf JOIN users u ON u.id=cf.follower_id WHERE cf.followed_id=? ORDER BY cf.created_at DESC`, targetID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	c.JSON(http.StatusOK, h.scanUserRows(rows))
}

func (h *Handlers) CommunityLevel(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	var posts, comments, checkins int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_posts WHERE user_id=?`, userID).Scan(&posts)
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_comments WHERE user_id=?`, userID).Scan(&comments)
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_checkins WHERE user_id=?`, userID).Scan(&checkins)
	points := posts*10 + comments*3 + checkins*5
	level := points/100 + 1
	c.JSON(http.StatusOK, gin.H{"level": level, "points": points, "posts": posts, "comments": comments, "checkins": checkins})
}

func (h *Handlers) CommunityUsers(c *gin.Context) {

	viewer, _ := expressauth.UserID(c)
	q := strings.TrimSpace(c.Query("query"))
	if q == "" {
		c.JSON(http.StatusOK, []any{})
		return
	}
	like := "%" + q + "%"
	rows, err := h.DB.Query(`SELECT id, username, COALESCE(nickname,username), avatar_url FROM users
		WHERE (username LIKE ? OR COALESCE(nickname,'') LIKE ?) AND (?=0 OR id<>?) ORDER BY id LIMIT 30`,
		like, like, viewer, viewer)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	c.JSON(http.StatusOK, h.scanUserRows(rows))
}

func (h *Handlers) CommunityUserProfile(c *gin.Context) {

	viewer, _ := expressauth.UserID(c)
	targetID, _ := strconv.Atoi(c.Param("id"))
	if targetID <= 0 {
		targetID, _ = strconv.Atoi(c.Param("userId"))
	}
	var username, nickname, avatar, bio sql.NullString
	if err := h.DB.QueryRow(`SELECT username, COALESCE(nickname,username), avatar_url, bio FROM users WHERE id=?`, targetID).
		Scan(&username, &nickname, &avatar, &bio); err != nil {
		httpx.SendError(c, http.StatusNotFound, "用户不存在", "USER_NOT_FOUND")
		return
	}
	following := false
	if viewer > 0 {
		var n int
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_follows WHERE follower_id=? AND followed_id=?`, viewer, targetID).Scan(&n)
		following = n > 0
	}
	var followersCount, followingCount, postsCount int
	if err := h.DB.QueryRow(`SELECT
		(SELECT COUNT(*) FROM community_follows WHERE followed_id=?),
		(SELECT COUNT(*) FROM community_follows WHERE follower_id=?),
		(SELECT COUNT(*) FROM community_posts WHERE user_id=?)`, targetID, targetID, targetID).
		Scan(&followersCount, &followingCount, &postsCount); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "个人主页加载失败", "PROFILE_FAILED")
		return
	}
	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 1 && n <= 50 {
			limit = n
		}
	}
	cursorID := 0
	cursorRaw := strings.TrimSpace(c.Query("cursor"))
	if cursorRaw == "" {
		cursorRaw = strings.TrimSpace(c.Query("after"))
	}
	if cursorRaw != "" {
		cursorID, _ = strconv.Atoi(cursorRaw)
	}
	imageURLsCol := "''"
	if h.hasColumn("community_posts", "image_urls") {
		imageURLsCol = "COALESCE(p.image_urls,'')"
	}
	q := `SELECT p.id, COALESCE(p.content,''), COALESCE(p.created_at,''), COALESCE(p.image_url,''), ` + imageURLsCol + `, COALESCE(p.category,''),
		(SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id=p.id)
		FROM community_posts p WHERE p.user_id=?`
	args := []any{targetID}
	if cursorID > 0 {
		q += ` AND p.id < ?`
		args = append(args, cursorID)
	}
	q += ` ORDER BY p.id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "动态加载失败", "PROFILE_FAILED")
		return
	}
	defer rows.Close()
	posts := make([]gin.H, 0)
	for rows.Next() {
		var id, likes int
		var content, createdAt, imageURL, imageURLsJSON, category string
		if err := rows.Scan(&id, &content, &createdAt, &imageURL, &imageURLsJSON, &category, &likes); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "动态加载失败", "PROFILE_FAILED")
			return
		}
		image := firstPostImage(imageURL, imageURLsJSON)
		posts = append(posts, gin.H{
			"id": id, "content": content, "created_at": createdAt, "likes_count": likes,
			"image_url": image, "category": category,
		})
	}
	if err := rows.Err(); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "动态加载失败", "PROFILE_FAILED")
		return
	}
	var nextCursor any
	hasMore := len(posts) > limit
	if hasMore {
		posts = posts[:limit]
		nextCursor = posts[len(posts)-1]["id"]
	}
	c.JSON(http.StatusOK, gin.H{
		"id": targetID, "username": nullStr(username), "nickname": nullStr(nickname),
		"avatar_url": nullStr(avatar), "bio": nullStr(bio), "following": following, "is_following": following,
		"followers_count": followersCount, "following_count": followingCount, "posts_count": postsCount, "posts": posts,
		"nextCursor": nextCursor, "hasMore": hasMore,
		// The full growth-level model has not been migrated; do not invent XP or a title.
		"level": nil,
	})
}

func (h *Handlers) CommunityFollow(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	targetID, _ := strconv.Atoi(c.Param("id"))
	if targetID <= 0 {
		targetID, _ = strconv.Atoi(c.Param("userId"))
	}
	if targetID <= 0 || targetID == userID {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	var exists int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_follows WHERE follower_id=? AND followed_id=?`, userID, targetID).Scan(&exists)
	if exists > 0 {
		_, _ = h.DB.Exec(`DELETE FROM community_follows WHERE follower_id=? AND followed_id=?`, userID, targetID)
		h.communityFollowResponse(c, userID, false)
		return
	}
	_, _ = h.DB.Exec(`INSERT INTO community_follows (follower_id, followed_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, userID, targetID)
	h.communityFollowResponse(c, userID, true)
}

func (h *Handlers) communityFollowResponse(c *gin.Context, userID int, following bool) {
	var count int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_follows WHERE follower_id=?`, userID).Scan(&count)
	c.JSON(http.StatusOK, gin.H{"following": following, "is_following": following, "following_count": count})
}

func (h *Handlers) CommunityUnfollow(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	targetID, _ := strconv.Atoi(c.Param("id"))
	if targetID <= 0 {
		targetID, _ = strconv.Atoi(c.Param("userId"))
	}
	_, _ = h.DB.Exec(`DELETE FROM community_follows WHERE follower_id=? AND followed_id=?`, userID, targetID)
	c.JSON(http.StatusOK, gin.H{"following": false})
}

func (h *Handlers) CommunityPostComments(c *gin.Context) {

	postID, _ := strconv.Atoi(c.Param("id"))
	rows, err := h.DB.Query(`SELECT id, post_id, user_id, COALESCE(username,''), content, COALESCE(likes_count,0), COALESCE(created_at,'')
		FROM community_comments WHERE post_id=? ORDER BY id ASC`, postID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, pid, uid, likes int
		var username, content, created string
		if rows.Scan(&id, &pid, &uid, &username, &content, &likes, &created) == nil {
			list = append(list, map[string]any{
				"id": id, "post_id": pid, "user_id": uid, "username": username, "content": content,
				"likes_count": likes, "created_at": created,
			})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CommunityCreateComment(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	postID, _ := strconv.Atoi(c.Param("id"))
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	content := strField(body, "content")
	if content == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	var username string
	_ = h.DB.QueryRow(`SELECT COALESCE(nickname,username,'食友') FROM users WHERE id=?`, userID).Scan(&username)
	id, err := h.DB.InsertID(`INSERT INTO community_comments (post_id, user_id, username, content) VALUES (?,?,?,?)`,
		postID, userID, username, content)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "评论失败", "COMMENT_FAILED")
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id, "post_id": postID, "user_id": userID, "username": username, "content": content})
}

func (h *Handlers) CommunityAcceptComment(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	postID, _ := strconv.Atoi(c.Param("id"))
	if postID == 0 {
		postID, _ = strconv.Atoi(c.Param("postId"))
	}
	commentID, _ := strconv.Atoi(c.Param("commentId"))
	var owner int
	if err := h.DB.QueryRow(`SELECT user_id FROM community_posts WHERE id=?`, postID).Scan(&owner); err != nil || owner != userID {
		httpx.SendError(c, http.StatusForbidden, "无权采纳评论", "FORBIDDEN")
		return
	}
	_, _ = h.DB.Exec(`UPDATE community_comments SET accepted=1 WHERE id=? AND post_id=?`, commentID, postID)
	_, _ = h.DB.Exec(`UPDATE community_posts SET accepted_comment_id=? WHERE id=?`, commentID, postID)
	c.JSON(http.StatusOK, gin.H{"accepted_comment_id": commentID})
}

func (h *Handlers) CommunityJoinPost(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	postID, _ := strconv.Atoi(c.Param("id"))

	var exists int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_event_participants WHERE post_id=? AND user_id=?`, postID, userID).Scan(&exists)
	joined := true
	if exists > 0 {
		_, _ = h.DB.Exec(`DELETE FROM community_event_participants WHERE post_id=? AND user_id=?`, postID, userID)
		joined = false
	} else {
		_, _ = h.DB.Exec(`INSERT INTO community_event_participants (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, postID, userID)
		joined = true
	}
	var participantCount int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_event_participants WHERE post_id=?`, postID).Scan(&participantCount)
	c.JSON(http.StatusOK, gin.H{
		"joined":             joined,
		"is_joined":          joined,
		"participant_count":  participantCount,
		"participantCount":   participantCount,
	})
}

func (h *Handlers) CommunitySharePost(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	postID, _ := strconv.Atoi(c.Param("id"))
	code := strings.ToUpper(newInviteCode())
	_, _ = h.DB.Exec(`INSERT INTO community_shares (code, post_id) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET post_id=excluded.post_id`, code, postID)
	_, _ = h.DB.Exec(`UPDATE community_posts SET share_code=? WHERE id=?`, code, postID)
	base := strings.TrimRight(fmt.Sprintf("%s://%s", c.Request.URL.Scheme, c.Request.Host), "/")
	if base == "://" {
		base = "http://localhost:9090"
	}
	c.JSON(http.StatusOK, gin.H{"shareCode": code, "url": base + "/share/posts/" + code, "postId": postID, "userId": userID})
}

func (h *Handlers) CommunityResolveShare(c *gin.Context) {

	code := strings.ToUpper(strings.TrimSpace(c.Param("code")))
	var postID int
	err := h.DB.QueryRow(`SELECT post_id FROM community_shares WHERE code=?`, code).Scan(&postID)
	if err != nil {
		_ = h.DB.QueryRow(`SELECT id FROM community_posts WHERE UPPER(COALESCE(share_code,''))=?`, code).Scan(&postID)
	}
	if postID <= 0 {
		httpx.SendError(c, http.StatusNotFound, "分享已失效", "SHARE_NOT_FOUND")
		return
	}
	var userID int
	var username, content, created sql.NullString
	if err := h.DB.QueryRow(`SELECT p.user_id, u.username, p.content, COALESCE(p.created_at,'')
		FROM community_posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=?`, postID).
		Scan(&userID, &username, &content, &created); err != nil {
		httpx.SendError(c, http.StatusNotFound, "分享已失效", "SHARE_NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{"postId": postID, "shareCode": code, "user_id": userID, "username": nullStr(username), "content": nullStr(content), "created_at": nullStr(created)})
}

func (h *Handlers) CommunityLikeComment(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	commentID, _ := strconv.Atoi(c.Param("id"))
	var exists int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_comment_likes WHERE comment_id=? AND user_id=?`, commentID, userID).Scan(&exists)
	if exists > 0 {
		_, _ = h.DB.Exec(`DELETE FROM community_comment_likes WHERE comment_id=? AND user_id=?`, commentID, userID)
		_, _ = h.DB.Exec(`UPDATE community_comments SET likes_count=CASE WHEN likes_count>0 THEN likes_count-1 ELSE 0 END WHERE id=?`, commentID)
		c.JSON(http.StatusOK, gin.H{"liked": false})
		return
	}
	_, _ = h.DB.Exec(`INSERT INTO community_comment_likes (comment_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, commentID, userID)
	_, _ = h.DB.Exec(`UPDATE community_comments SET likes_count=COALESCE(likes_count,0)+1 WHERE id=?`, commentID)
	c.JSON(http.StatusOK, gin.H{"liked": true})
}

func (h *Handlers) scanUserRows(rows *sql.Rows) []map[string]any {
	list := make([]map[string]any, 0)
	cols, _ := rows.Columns()
	withCreated := len(cols) >= 5
	for rows.Next() {
		var id int
		var username, nickname, avatar sql.NullString
		var created sql.NullString
		var err error
		if withCreated {
			err = rows.Scan(&id, &username, &nickname, &avatar, &created)
		} else {
			err = rows.Scan(&id, &username, &nickname, &avatar)
		}
		if err != nil {
			continue
		}
		item := map[string]any{
			"id": id, "username": nullStr(username), "nickname": nullStr(nickname), "avatar_url": nullStr(avatar),
		}
		if withCreated {
			item["created_at"] = nullStr(created)
		}
		list = append(list, item)
	}
	return list
}

func firstPostImage(imageURL, imageURLsJSON string) any {
	if u := strings.TrimSpace(imageURL); u != "" {
		return u
	}
	raw := strings.TrimSpace(imageURLsJSON)
	if raw == "" {
		return nil
	}
	var urls []string
	if json.Unmarshal([]byte(raw), &urls) == nil {
		for _, u := range urls {
			if t := strings.TrimSpace(u); t != "" {
				return t
			}
		}
	}
	return nil
}
