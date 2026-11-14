// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) ListCommunity(c *gin.Context) {
	page, pageSize, offset := parsePageParams(c, 50, 200)
	if !h.hasTable("community_posts") {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "posts": []any{}, "total": 0, "page": page, "pageSize": pageSize, "nextCursor": nil})
		return
	}
	hasCategory := h.hasColumn("community_posts", "category")
	hasAvatar := h.hasColumn("community_posts", "avatar_url")
	hasImage := h.hasColumn("community_posts", "image_url")
	hasLikes := h.hasColumn("community_posts", "likes_count")
	hasViews := h.hasColumn("community_posts", "views_count")
	hasComments := h.hasColumn("community_posts", "comment_count")
	whereParts := []string{"1=1"}
	args := make([]any, 0)
	if h.hasColumn("community_posts", "deleted_at") {
		whereParts = []string{"p.deleted_at IS NULL"}
	}
	if search := strings.TrimSpace(firstNonEmpty(c.Query("search"), c.Query("q"))); search != "" {
		whereParts = append(whereParts, "(p.content LIKE ? OR COALESCE(u.username,'') LIKE ? OR COALESCE(p.username,'') LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	if category := strings.TrimSpace(c.Query("category")); category != "" && category != "全部" && hasCategory {
		whereParts = append(whereParts, "p.category=?")
		args = append(args, category)
	}
	where := strings.Join(whereParts, " AND ")
	var total int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_posts p LEFT JOIN users u ON u.id=p.user_id WHERE `+where, args...).Scan(&total)
	q := `SELECT p.id, p.user_id, COALESCE(p.content,''), COALESCE(p.created_at,''), COALESCE(u.username,''), COALESCE(u.avatar_url,'')`
	if hasCategory {
		q += `, COALESCE(p.category,'')`
	} else {
		q += `, ''`
	}
	if hasAvatar {
		q += `, COALESCE(p.avatar_url,'')`
	} else {
		q += `, ''`
	}
	if hasImage {
		q += `, COALESCE(p.image_url,'')`
	} else {
		q += `, ''`
	}
	if hasLikes {
		q += `, COALESCE(p.likes_count,0)`
	} else {
		q += `, 0`
	}
	if hasViews {
		q += `, COALESCE(p.views_count,0)`
	} else {
		q += `, 0`
	}
	if hasComments {
		q += `, COALESCE(p.comment_count,0)`
	} else {
		q += `, 0`
	}
	q += ` FROM community_posts p LEFT JOIN users u ON u.id=p.user_id WHERE ` + where + ` ORDER BY p.id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := h.DB.Query(q, queryArgs...)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取社区内容失败", "COMMUNITY_LIST_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, userID, likes, views, comments int
		var content, created, username, userAvatar, category, avatar, image string
		if err := rows.Scan(&id, &userID, &content, &created, &username, &userAvatar, &category, &avatar, &image, &likes, &views, &comments); err != nil {
			continue
		}
		if avatar == "" {
			avatar = userAvatar
		}
		list = append(list, map[string]any{
			"id": id, "user_id": userID, "userId": userID, "username": username,
			"avatar_url": avatar, "category": category, "content": content,
			"image_url": image, "likes_count": likes, "views_count": views,
			"comment_count": comments, "created_at": created, "createdAt": created,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": list, "posts": list, "total": total, "page": page, "pageSize": pageSize, "nextCursor": nil})
}

func (h *Handlers) DeleteCommunity(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if h.hasTable("community_posts") {
		_, _ = h.DB.Exec(`DELETE FROM community_posts WHERE id=?`, id)
	}
	h.recordAudit(c, "community.delete", "community_post", strconv.Itoa(id), "删除社区帖子")
	okJSON(c)
}

func (h *Handlers) CommunityComments(c *gin.Context) {
	if !h.hasTable("community_comments") {
		c.JSON(http.StatusOK, gin.H{"comments": []any{}, "items": []any{}})
		return
	}
	postID, _ := strconv.Atoi(c.Param("id"))
	userJoin := ""
	if h.hasTable("users") {
		userJoin = ` LEFT JOIN users u ON u.id = c.user_id`
	}
	acceptedCol := "0"
	if h.hasColumn("community_comments", "accepted") {
		acceptedCol = "COALESCE(c.accepted,0)"
	} else if h.hasColumn("community_comments", "is_accepted") {
		acceptedCol = "COALESCE(c.is_accepted,0)"
	}
	likesCol := "0"
	if h.hasColumn("community_comments", "likes_count") {
		likesCol = "COALESCE(c.likes_count,0)"
	}
	expertCol := "0"
	if h.hasColumn("users", "is_verified_expert") {
		expertCol = "COALESCE(u.is_verified_expert,0)"
	}
	avatarCol := "''"
	if h.hasColumn("users", "avatar_url") {
		avatarCol = "COALESCE(u.avatar_url,'')"
	}
	q := `SELECT c.id, c.post_id, c.user_id, COALESCE(c.content,''), COALESCE(c.created_at,''),
		COALESCE(u.username,''), ` + avatarCol + `, ` + likesCol + `, ` + acceptedCol + `, ` + expertCol + `
		FROM community_comments c` + userJoin
	args := []any{}
	if postID > 0 {
		q += ` WHERE c.post_id=?`
		args = append(args, postID)
	}
	q += ` ORDER BY c.id DESC LIMIT 200`
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"comments": []any{}, "items": []any{}})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, postIDVal, userID, likes, accepted, expert int
		var content, created, username, avatar string
		if err := rows.Scan(&id, &postIDVal, &userID, &content, &created, &username, &avatar, &likes, &accepted, &expert); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "post_id": postIDVal, "postId": postIDVal,
			"user_id": userID, "userId": userID,
			"content": content, "created_at": created, "createdAt": created,
			"username": username, "avatar_url": avatar,
			"likes_count": likes, "is_accepted": accepted == 1, "is_expert_answer": expert == 1,
		})
	}
	c.JSON(http.StatusOK, gin.H{"comments": list, "items": list})
}

func (h *Handlers) DeleteCommunityComment(c *gin.Context) {
	id := c.Param("id")
	if h.hasTable("community_comments") {
		_, _ = h.DB.Exec(`DELETE FROM community_comments WHERE id=?`, id)
	}
	h.recordAudit(c, "community.comment.delete", "community_comment", id, "删除评论")
	okJSON(c)
}

func (h *Handlers) CommunityEventPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.recordAudit(c, "community.event.update", "community_post", strconv.Itoa(id), "更新活动帖")
	okJSON(c)
}

func (h *Handlers) CommunityQuestionPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.recordAudit(c, "community.question.update", "community_post", strconv.Itoa(id), "更新问答帖")
	okJSON(c)
}
