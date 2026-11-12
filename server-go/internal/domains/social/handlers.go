// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"database/sql"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"html"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

// Handlers covers community, households, notifications, feedback, media, share pages.
type Handlers struct {
	DB   *dbx.DB
	Auth *expressauth.Auth
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {

	auth := h.Auth.Middleware()
	opt := h.optional()

	community := engine.Group("/api/v1/community")
	{
		community.GET("/posts", opt, h.ListPosts)
		community.GET("/posts/:id", opt, h.GetPost)
		community.POST("/posts", auth, h.CreatePost)
		community.POST("/posts/:id/like", auth, h.LikePost)
		community.DELETE("/posts/:id/like", auth, h.UnlikePost)
		community.GET("/posts/:id/comments", opt, h.CommunityPostComments)
		community.POST("/posts/:id/comments", auth, h.CommunityCreateComment)
		community.POST("/posts/:id/comments/:commentId/accept", auth, h.CommunityAcceptComment)
		community.POST("/posts/:id/join", auth, h.CommunityJoinPost)
		community.POST("/posts/:id/share", h.CommunitySharePost)
		community.GET("/shares/:code", h.CommunityResolveShare)
		community.POST("/comments/:id/like", auth, h.CommunityLikeComment)

		community.GET("/users", opt, h.CommunityUsers)
		community.GET("/following", auth, h.CommunityFollowing)
		community.GET("/level", auth, h.CommunityLevel)
		community.GET("/check-in", auth, h.CommunityCheckInGet)
		community.POST("/check-in", auth, h.CommunityCheckInPost)
		community.GET("/users/:id/profile", opt, h.CommunityUserProfile)
		community.GET("/users/:id/following", opt, h.CommunityUserFollowing)
		community.GET("/users/:id/followers", opt, h.CommunityUserFollowers)
		community.POST("/users/:id/follow", auth, h.CommunityFollow)
		community.DELETE("/users/:id/follow", auth, h.CommunityUnfollow)
	}

	hh := engine.Group("/api/v1/households")
	hh.Use(auth)
	{
		hh.GET("", h.ListHouseholds)
		hh.POST("", h.CreateHousehold)
		hh.GET("/mine", h.MineHouseholds)
		hh.POST("/join", h.JoinHousehold)

		hh.POST("/:id/leave", h.LeaveHousehold)
		hh.POST("/:id/transfer-owner", h.TransferHouseholdOwner)
		hh.POST("/:id/dining-allocation-preview", h.DiningAllocationPreview)
		hh.GET("/:id/dining-members", h.DiningMembers)
		hh.GET("/:id/dining-preferences", h.GetDiningPreferences)
		hh.PUT("/:id/dining-preferences", h.PutDiningPreferences)
		hh.GET("/:id/history", h.HouseholdHistory)
		hh.GET("/:id/inventory", h.ListHouseholdInventory)
		hh.POST("/:id/inventory", h.CreateHouseholdInventory)
		hh.PUT("/:id/inventory/:itemId", h.UpdateHouseholdInventory)
		hh.DELETE("/:id/inventory/:itemId", h.DeleteHouseholdInventory)
		hh.GET("/:id/meals", h.ListHouseholdMeals)
		hh.POST("/:id/meals", h.CreateHouseholdMeal)
		hh.POST("/:id/meals/:mealId/eat", h.EatHouseholdMeal)
		hh.PUT("/:id/meals/:mealId/reservation", h.ReserveHouseholdMeal)
		hh.GET("/:id/shopping-list", h.ListHouseholdShopping)
		hh.POST("/:id/shopping-list", h.CreateHouseholdShopping)
		hh.PATCH("/:id/shopping-list/:itemId", h.PatchHouseholdShopping)
		hh.PUT("/:id/shopping-list/:itemId", h.UpdateHouseholdShopping)
		hh.DELETE("/:id/shopping-list/:itemId", h.DeleteHouseholdShopping)
		hh.POST("/:id/shopping-list/intake", h.ShoppingIntake)
	}

	notif := engine.Group("/api/v1/notifications")
	notif.Use(auth)
	{
		notif.GET("", h.ListNotifications)
		notif.GET("/unread-count", h.NotificationUnreadCount)
		notif.GET("/history", h.NotificationHistory)
		notif.GET("/preferences", h.NotificationPreferencesGet)
		notif.PUT("/preferences", h.NotificationPreferencesPut)
		notif.GET("/intervention-preferences", h.InterventionPreferencesGet)
		notif.PUT("/intervention-preferences", h.InterventionPreferencesPut)
		notif.PUT("/device", h.NotificationDevicePut)
		notif.PUT("/read-all", h.NotificationReadAll)
		notif.POST("/local-event", h.NotificationLocalEvent)
		notif.GET("/interventions/:id", h.InterventionGet)
		notif.POST("/interventions/:id/feedback", h.InterventionFeedback)
		notif.PUT("/:id/read", h.ReadNotificationPut)
		notif.POST("/:id/read", h.ReadNotification)
		notif.POST("/:id/actions", h.NotificationAction)
	}

	fb := engine.Group("/api/v1/feedback")
	fb.Use(auth)
	{
		fb.GET("/admin", h.requireAdmin(), h.FeedbackAdminList)
		fb.GET("/admin/:id", h.requireAdmin(), h.FeedbackAdminDetail)
		fb.POST("/admin/:id/replies", h.requireAdmin(), h.FeedbackAdminReply)
		fb.GET("", h.ListFeedback)
		fb.POST("", h.CreateFeedback)
		fb.GET("/:id", h.FeedbackDetail)
		fb.POST("/:id/replies", h.FeedbackReply)
	}

	engine.Static("/media/uploads", mediaUploadRoot())
	engine.GET("/api/v1/media/ping", auth, func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	engine.POST("/api/v1/media/images", auth, h.UploadImage)

	engine.GET("/share/posts/:code", h.SharePost)

}

func (h *Handlers) optional() gin.HandlerFunc { return h.Auth.OptionalMiddleware() }

func (h *Handlers) UnlikePost(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	_, _ = h.DB.Exec(`DELETE FROM community_post_likes WHERE post_id=? AND user_id=?`, id, userID)
	var count int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_post_likes WHERE post_id=?`, id).Scan(&count)
	if h.DB.HasColumn("community_posts", "likes_count") {
		_, _ = h.DB.Exec(`UPDATE community_posts SET likes_count=? WHERE id=?`, count, id)
	}
	c.JSON(http.StatusOK, gin.H{"liked": false, "is_liked": false, "likes_count": count})
}

func (h *Handlers) ListHouseholds(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT h.id, h.name FROM households h
		JOIN household_members m ON m.household_id=h.id WHERE m.user_id=?`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err == nil {
			list = append(list, map[string]any{"id": id, "name": name})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateHousehold(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	var body struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	tx, err := h.DB.Begin()
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建家庭失败", "HOUSEHOLD_FAILED")
		return
	}
	defer func() { _ = tx.Rollback() }()
	inviteCode := newInviteCode()
	id, err := h.insertHousehold(tx, body.Name, userID, inviteCode)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建家庭失败", "HOUSEHOLD_FAILED")
		return
	}
	_, _ = tx.Exec(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')`, id, userID)
	if err := tx.Commit(); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建家庭失败", "HOUSEHOLD_FAILED")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "name": body.Name, "invite_code": inviteCode, "owner_id": userID})
}

func (h *Handlers) ListNotifications(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	if h.inboxTableExists() {
		list := h.fetchNotifications(userID, 0, 100, "all")
		c.JSON(http.StatusOK, list)
		return
	}
	rows, err := h.DB.Query(`SELECT id, COALESCE(title,''), COALESCE(body,''), COALESCE(read_at,''), COALESCE(created_at,'')
		FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var title, body, readAt, created string
		if err := rows.Scan(&id, &title, &body, &readAt, &created); err == nil {
			list = append(list, map[string]any{"id": id, "title": title, "body": body, "read_at": emptyNil(readAt), "created_at": created})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) ReadNotification(c *gin.Context) {
	h.markNotificationRead(c)
}

func (h *Handlers) ListFeedback(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	c.JSON(http.StatusOK, h.feedbackList(userID, 20, c))
}

func (h *Handlers) CreateFeedback(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	var body struct {
		Content  string         `json:"content"`
		Category string         `json:"category"`
		Context  map[string]any `json:"context"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Content) == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	category := strings.TrimSpace(body.Category)
	if category == "" {
		category = "issue"
	}
	var contextJSON any
	if body.Context != nil {
		contextJSON = body.Context
	}
	id, err := h.DB.InsertID(`INSERT INTO user_feedback (user_id, category, content, context_json, status) VALUES (?, ?, ?, ?, 'received')`,
		userID, category, body.Content, contextJSON)
	if err != nil {
		id, err = h.DB.InsertID(`INSERT INTO user_feedback (user_id, content) VALUES (?, ?)`, userID, body.Content)
		if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "提交反馈失败", "FEEDBACK_FAILED")
			return
		}
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "content": body.Content, "category": category, "status": "received"})
}

func (h *Handlers) SharePost(c *gin.Context) {
	code := strings.ToUpper(strings.TrimSpace(c.Param("code")))
	var postID int
	var username, content sql.NullString
	err := h.DB.QueryRow(`SELECT p.id, u.username, p.content FROM community_posts p
		LEFT JOIN users u ON u.id=p.user_id WHERE UPPER(COALESCE(p.share_code,''))=?`, code).
		Scan(&postID, &username, &content)
	if err != nil {
		c.Data(http.StatusNotFound, "text/html; charset=utf-8", []byte("<!doctype html><meta charset=utf-8><title>分享已失效</title><p>该拾味分享已失效或不存在。</p>"))
		return
	}
	appURL := "dietdigidose://post-detail?id=" + strconv.Itoa(postID) + "&shareCode=" + code
	userLabel := ""
	if username.Valid {
		userLabel = username.String
	}
	contentLabel := ""
	if content.Valid {
		contentLabel = content.String
	}
	page := "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
		"<title>拾味社区分享</title><div><h1>拾味社区</h1><p><strong>" + html.EscapeString(userLabel) +
		"</strong> 的健康分享</p><p>" + html.EscapeString(truncate(contentLabel, 220)) +
		"</p><a href=\"" + appURL + "\">打开拾味日常查看</a></div></html>"
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(page))
}

func nullStr(v sql.NullString) any {
	if !v.Valid {
		return nil
	}
	return v.String
}

func emptyNil(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
