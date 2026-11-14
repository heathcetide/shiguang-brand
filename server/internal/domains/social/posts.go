// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

type communityPostRow struct {
	ID               int
	UserID           int
	Username         string
	Nickname         sql.NullString
	AvatarURL        sql.NullString
	Category         sql.NullString
	Content          sql.NullString
	ImageURL         sql.NullString
	ImageURLs        sql.NullString
	LikesCount       int
	CommentCount     int
	ViewsCount       int
	EventStartAt     sql.NullString
	EventEndAt       sql.NullString
	QuestionStatus   sql.NullString
	AcceptedComment  sql.NullInt64
	IpLocation       sql.NullString
	CreatedAt        string
	IsLiked          bool
	IsJoined         bool
	ParticipantCount int
	AuthorIsExpert   bool
	AuthorIsFollowed bool
}

func (h *Handlers) ListPosts(c *gin.Context) {
	viewer, _ := expressauth.UserID(c)
	category := strings.TrimSpace(c.Query("category"))
	search := strings.TrimSpace(c.Query("search"))
	if search == "" {
		search = strings.TrimSpace(c.Query("q"))
	}
	pageSize := parsePositiveInt(c.Query("pageSize"), 12)
	if pageSize > 50 {
		pageSize = 50
	}
	// Client also calls ?limit= for the global search screen.
	if limit := parsePositiveInt(c.Query("limit"), 0); limit > 0 {
		pageSize = limit
		if pageSize > 50 {
			pageSize = 50
		}
	}

	cursorID := 0
	if raw := strings.TrimSpace(c.Query("cursor")); raw != "" {
		if decoded, err := decodePostCursor(raw); err == nil {
			cursorID = decoded
		}
	}

	posts, err := h.queryCommunityPosts(viewer, category, search, cursorID, pageSize+1)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "nextCursor": nil})
		return
	}

	var nextCursor any
	if len(posts) > pageSize {
		last := posts[pageSize-1]
		nextCursor = encodePostCursor(last.ID)
		posts = posts[:pageSize]
	}

	items := make([]gin.H, 0, len(posts))
	for _, post := range posts {
		items = append(items, h.serializeCommunityPost(post))
	}

	// Prefer Express-compatible page shape; keep bare arrays for tiny legacy callers
	// only when neither pageSize nor cursor/search/category is requested.
	if c.Query("pageSize") != "" || c.Query("cursor") != "" || c.Query("limit") != "" || category != "" || search != "" {
		c.JSON(http.StatusOK, gin.H{"items": items, "nextCursor": nextCursor})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "nextCursor": nextCursor})
}

func (h *Handlers) GetPost(c *gin.Context) {
	viewer, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		httpx.SendError(c, http.StatusNotFound, "帖子不存在", "POST_NOT_FOUND")
		return
	}
	posts, err := h.queryCommunityPosts(viewer, "", "", 0, 1, id)
	if err != nil || len(posts) == 0 {
		httpx.SendError(c, http.StatusNotFound, "帖子不存在", "POST_NOT_FOUND")
		return
	}
	if h.DB.HasColumn("community_posts", "views_count") {
		_, _ = h.DB.Exec(`UPDATE community_posts SET views_count=COALESCE(views_count,0)+1 WHERE id=?`, id)
		posts[0].ViewsCount++
	}
	c.JSON(http.StatusOK, h.serializeCommunityPost(posts[0]))
}

func (h *Handlers) CreatePost(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		Content      string   `json:"content"`
		Category     string   `json:"category"`
		ImageURL     string   `json:"image_url"`
		ImageURLs    []string `json:"image_urls"`
		EventStartAt string   `json:"event_start_at"`
		EventEndAt   string   `json:"event_end_at"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	content := strings.TrimSpace(body.Content)
	images := make([]string, 0, 9)
	for _, url := range body.ImageURLs {
		url = strings.TrimSpace(url)
		if url != "" {
			images = append(images, url)
		}
	}
	if url := strings.TrimSpace(body.ImageURL); url != "" && len(images) == 0 {
		images = append(images, url)
	}
	if content == "" && len(images) == 0 {
		httpx.SendError(c, http.StatusBadRequest, "请填写内容或添加图片", "INVALID_BODY")
		return
	}
	if len(images) > 9 {
		images = images[:9]
	}
	category := strings.TrimSpace(body.Category)
	switch category {
	case "寻味", "榜单", "活动", "问答":
	default:
		category = "寻味"
	}

	var username, avatar sql.NullString
	_ = h.DB.QueryRow(`SELECT username, avatar_url FROM users WHERE id=?`, userID).Scan(&username, &avatar)

	var eventStart, eventEnd, questionStatus any
	if category == "活动" {
		start := strings.TrimSpace(body.EventStartAt)
		end := strings.TrimSpace(body.EventEndAt)
		if start == "" || end == "" {
			httpx.SendError(c, http.StatusBadRequest, "活动需要开始和结束时间", "INVALID_BODY")
			return
		}
		eventStart, eventEnd = start, end
	}
	if category == "问答" {
		questionStatus = "open"
	}

	var imageURL any
	var imageURLs any
	if len(images) > 0 {
		imageURL = images[0]
		encoded, _ := json.Marshal(images)
		imageURLs = string(encoded)
	}

	cols := []string{"user_id", "content"}
	args := []any{userID, content}
	if h.DB.HasColumn("community_posts", "username") {
		cols = append(cols, "username")
		args = append(args, validString(username))
	}
	if h.DB.HasColumn("community_posts", "avatar_url") {
		cols = append(cols, "avatar_url")
		args = append(args, validString(avatar))
	}
	if h.DB.HasColumn("community_posts", "category") {
		cols = append(cols, "category")
		args = append(args, category)
	}
	if h.DB.HasColumn("community_posts", "image_url") {
		cols = append(cols, "image_url")
		args = append(args, imageURL)
	}
	if h.DB.HasColumn("community_posts", "image_urls") {
		cols = append(cols, "image_urls")
		args = append(args, imageURLs)
	}
	if h.DB.HasColumn("community_posts", "event_start_at") {
		cols = append(cols, "event_start_at")
		args = append(args, eventStart)
	}
	if h.DB.HasColumn("community_posts", "event_end_at") {
		cols = append(cols, "event_end_at")
		args = append(args, eventEnd)
	}
	if h.DB.HasColumn("community_posts", "question_status") {
		cols = append(cols, "question_status")
		args = append(args, questionStatus)
	}
	if h.DB.HasColumn("community_posts", "likes_count") {
		cols = append(cols, "likes_count")
		args = append(args, 0)
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(cols)), ",")
	id, err := h.DB.InsertID(`INSERT INTO community_posts (`+strings.Join(cols, ",")+`) VALUES (`+placeholders+`)`, args...)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "发帖失败", "POST_FAILED")
		return
	}
	posts, err := h.queryCommunityPosts(userID, "", "", 0, 1, int(id))
	if err != nil || len(posts) == 0 {
		c.JSON(http.StatusCreated, gin.H{"id": id, "user_id": userID, "content": content, "category": category})
		return
	}
	c.JSON(http.StatusCreated, h.serializeCommunityPost(posts[0]))
}

func (h *Handlers) LikePost(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		httpx.SendError(c, http.StatusNotFound, "帖子不存在", "POST_NOT_FOUND")
		return
	}
	var exists int
	if err := h.DB.QueryRow(`SELECT COUNT(*) FROM community_posts WHERE id=? AND (deleted_at IS NULL OR deleted_at='')`, id).Scan(&exists); err != nil || exists == 0 {
		// Some installs lack deleted_at; fall back.
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_posts WHERE id=?`, id).Scan(&exists)
		if exists == 0 {
			httpx.SendError(c, http.StatusNotFound, "帖子不存在", "POST_NOT_FOUND")
			return
		}
	}

	var liked int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_post_likes WHERE post_id=? AND user_id=?`, id, userID).Scan(&liked)
	active := liked == 0
	if active {
		_, _ = h.DB.Exec(`INSERT INTO community_post_likes (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, id, userID)
	} else {
		_, _ = h.DB.Exec(`DELETE FROM community_post_likes WHERE post_id=? AND user_id=?`, id, userID)
	}
	var count int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_post_likes WHERE post_id=?`, id).Scan(&count)
	if h.DB.HasColumn("community_posts", "likes_count") {
		_, _ = h.DB.Exec(`UPDATE community_posts SET likes_count=? WHERE id=?`, count, id)
	}
	c.JSON(http.StatusOK, gin.H{"is_liked": active, "liked": active, "likes_count": count})
}

func (h *Handlers) queryCommunityPosts(viewer int, category, search string, beforeID, limit int, exactIDs ...int) ([]communityPostRow, error) {
	hasDeleted := h.DB.HasColumn("community_posts", "deleted_at")
	hasCategory := h.DB.HasColumn("community_posts", "category")
	hasImage := h.DB.HasColumn("community_posts", "image_url")
	hasImageURLs := h.DB.HasColumn("community_posts", "image_urls")
	hasLikesCol := h.DB.HasColumn("community_posts", "likes_count")
	hasCommentCol := h.DB.HasColumn("community_posts", "comment_count")
	hasViewsCol := h.DB.HasColumn("community_posts", "views_count")
	hasEventStart := h.DB.HasColumn("community_posts", "event_start_at")
	hasEventEnd := h.DB.HasColumn("community_posts", "event_end_at")
	hasQuestion := h.DB.HasColumn("community_posts", "question_status")
	hasAccepted := h.DB.HasColumn("community_posts", "accepted_comment_id")
	hasAvatar := h.DB.HasColumn("community_posts", "avatar_url")
	hasNickname := h.DB.HasColumn("users", "nickname")
	hasIpLocation := h.DB.HasColumn("community_posts", "ip_location")
	hasExpert := h.DB.HasColumn("users", "is_verified_expert")
	hasFollows := true

	likesExpr := `(SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id=p.id)`
	if hasLikesCol {
		likesExpr = `COALESCE(p.likes_count, (` + likesExpr + `))`
	}
	commentExpr := `(SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id)`
	if hasCommentCol {
		commentExpr = `COALESCE(p.comment_count, (` + commentExpr + `))`
	}
	viewsExpr := `0`
	if hasViewsCol {
		viewsExpr = `COALESCE(p.views_count,0)`
	}
	imageExpr := `NULL`
	if hasImage {
		imageExpr = `p.image_url`
	}
	imageURLsExpr := `NULL`
	if hasImageURLs {
		imageURLsExpr = `p.image_urls`
	}
	categoryExpr := `'寻味'`
	if hasCategory {
		categoryExpr = `COALESCE(NULLIF(p.category,''),'寻味')`
	}
	avatarExpr := `u.avatar_url`
	if hasAvatar {
		avatarExpr = `COALESCE(NULLIF(p.avatar_url,''), u.avatar_url)`
	}
	nicknameExpr := `NULL`
	if hasNickname {
		nicknameExpr = `COALESCE(NULLIF(u.nickname,''), NULLIF(p.nickname,''), u.username)`
	}
	eventStartExpr := `NULL`
	if hasEventStart {
		eventStartExpr = `p.event_start_at`
	}
	eventEndExpr := `NULL`
	if hasEventEnd {
		eventEndExpr = `p.event_end_at`
	}
	questionExpr := `NULL`
	if hasQuestion {
		questionExpr = `p.question_status`
	}
	acceptedExpr := `NULL`
	if hasAccepted {
		acceptedExpr = `p.accepted_comment_id`
	}
	ipLocationExpr := `NULL`
	if hasIpLocation {
		ipLocationExpr = `p.ip_location`
	}
	expertExpr := `0`
	if hasExpert {
		expertExpr = `COALESCE(u.is_verified_expert,0)`
	}
	followedExpr := `0`
	if hasFollows {
		followedExpr = `CASE WHEN ? > 0 AND EXISTS(SELECT 1 FROM community_follows f WHERE f.follower_id=? AND f.followed_id=p.user_id) THEN 1 ELSE 0 END`
	}

	q := `SELECT p.id, p.user_id, COALESCE(NULLIF(u.username,''), NULLIF(p.username,''), '食友'||p.user_id),
		` + nicknameExpr + `, ` + avatarExpr + `, ` + categoryExpr + `, p.content, ` + imageExpr + `, ` + imageURLsExpr + `,
		` + likesExpr + `, ` + commentExpr + `, ` + viewsExpr + `,
		` + eventStartExpr + `, ` + eventEndExpr + `, ` + questionExpr + `, ` + acceptedExpr + `,
		` + ipLocationExpr + `, COALESCE(p.created_at,''),
		CASE WHEN EXISTS(SELECT 1 FROM community_post_likes l WHERE l.post_id=p.id AND l.user_id=?) THEN 1 ELSE 0 END,
		CASE WHEN EXISTS(SELECT 1 FROM community_event_participants ep WHERE ep.post_id=p.id AND ep.user_id=?) THEN 1 ELSE 0 END,
		(SELECT COUNT(*) FROM community_event_participants ep WHERE ep.post_id=p.id),
		` + expertExpr + `, ` + followedExpr + `
		FROM community_posts p
		LEFT JOIN users u ON u.id=p.user_id
		WHERE 1=1`
	args := []any{viewer, viewer, viewer, viewer}

	if hasDeleted {
		q += ` AND (p.deleted_at IS NULL OR p.deleted_at='')`
	}
	if len(exactIDs) > 0 {
		q += ` AND p.id=?`
		args = append(args, exactIDs[0])
	}
	if category != "" && hasCategory {
		q += ` AND COALESCE(NULLIF(p.category,''),'寻味')=?`
		args = append(args, category)
	}
	if search != "" {
		like := "%" + search + "%"
		q += ` AND (p.content LIKE ? OR COALESCE(u.username,'') LIKE ? OR COALESCE(u.nickname,'') LIKE ?`
		args = append(args, like, like, like)
		if hasCategory {
			q += ` OR COALESCE(p.category,'') LIKE ?`
			args = append(args, like)
		}
		q += `)`
	}
	if beforeID > 0 {
		q += ` AND p.id<?`
		args = append(args, beforeID)
	}
	q += ` ORDER BY p.created_at DESC, p.id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := h.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]communityPostRow, 0)
	for rows.Next() {
		var row communityPostRow
		var liked, joined, expert, followed int
		if err := rows.Scan(
			&row.ID, &row.UserID, &row.Username, &row.Nickname, &row.AvatarURL, &row.Category, &row.Content,
			&row.ImageURL, &row.ImageURLs, &row.LikesCount, &row.CommentCount, &row.ViewsCount,
			&row.EventStartAt, &row.EventEndAt, &row.QuestionStatus, &row.AcceptedComment, &row.IpLocation, &row.CreatedAt,
			&liked, &joined, &row.ParticipantCount, &expert, &followed,
		); err != nil {
			return nil, err
		}
		row.IsLiked = liked == 1
		row.IsJoined = joined == 1
		row.AuthorIsExpert = expert == 1
		row.AuthorIsFollowed = followed == 1
		out = append(out, row)
	}
	return out, rows.Err()
}

func (h *Handlers) serializeCommunityPost(post communityPostRow) gin.H {
	images := parseImageURLs(validString(post.ImageURLs), validString(post.ImageURL))
	imageURL := validString(post.ImageURL)
	if imageURL == "" && len(images) > 0 {
		imageURL = images[0]
	}
	category := validString(post.Category)
	if category == "" {
		category = "寻味"
	}
	var question any
	if qs := validString(post.QuestionStatus); qs != "" {
		question = qs
	} else if category == "问答" {
		question = "open"
	} else {
		question = nil
	}
	var accepted any
	if post.AcceptedComment.Valid {
		accepted = post.AcceptedComment.Int64
	} else {
		accepted = nil
	}
	nickname := validString(post.Nickname)
	if nickname == "" {
		nickname = post.Username
	}
	return gin.H{
		"id":                  post.ID,
		"user_id":             post.UserID,
		"username":            post.Username,
		"nickname":            nickname,
		"avatar_url":          emptyNil(validString(post.AvatarURL)),
		"category":            category,
		"content":             validString(post.Content),
		"image_url":           emptyNil(imageURL),
		"image_urls":          images,
		"likes_count":         post.LikesCount,
		"comment_count":       post.CommentCount,
		"views_count":         post.ViewsCount,
		"event_start_at":      emptyNil(validString(post.EventStartAt)),
		"event_end_at":        emptyNil(validString(post.EventEndAt)),
		"question_status":     question,
		"accepted_comment_id": accepted,
		"ip_location":         emptyNil(validString(post.IpLocation)),
		"is_liked":            post.IsLiked,
		"is_joined":           post.IsJoined,
		"participant_count":   post.ParticipantCount,
		"author_is_expert":    post.AuthorIsExpert,
		"author_is_followed":  post.AuthorIsFollowed,
		"created_at":          post.CreatedAt,
	}
}

func validString(v sql.NullString) string {
	if !v.Valid {
		return ""
	}
	return v.String
}

func parseImageURLs(raw, fallback string) []string {
	out := make([]string, 0)
	if strings.TrimSpace(raw) != "" {
		var parsed []string
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			for _, item := range parsed {
				item = strings.TrimSpace(item)
				if item != "" {
					out = append(out, item)
				}
			}
		}
	}
	if len(out) == 0 && strings.TrimSpace(fallback) != "" {
		out = append(out, strings.TrimSpace(fallback))
	}
	return out
}

func parsePositiveInt(raw string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func encodePostCursor(id int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(id)))
}

func decodePostCursor(raw string) (int, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		if n, err2 := strconv.Atoi(raw); err2 == nil {
			return n, nil
		}
		return 0, err
	}
	return strconv.Atoi(string(decoded))
}
