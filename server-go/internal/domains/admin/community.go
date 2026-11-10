// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) ListCommunity(c *gin.Context) {
	if !h.hasTable("community_posts") {
		emptyJSONArray(c, "posts")
		return
	}
	rows, err := h.DB.Query(`SELECT p.id, p.user_id, COALESCE(p.content,''), COALESCE(p.created_at,''), u.username
		FROM community_posts p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 200`)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取社区内容失败", "COMMUNITY_LIST_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, userID int
		var content, created, username sql.NullString
		if err := rows.Scan(&id, &userID, &content, &created, &username); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "userId": userID, "content": nullStr(content),
			"createdAt": nullStr(created), "username": nullStr(username),
		})
	}
	c.JSON(http.StatusOK, gin.H{"posts": list})
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
		c.JSON(http.StatusOK, gin.H{"comments": []any{}})
		return
	}
	postJoin := ""
	if h.hasTable("community_posts") {
		postJoin = ` LEFT JOIN community_posts p ON p.id = c.post_id`
	}
	userJoin := ""
	if h.hasTable("users") {
		userJoin = ` LEFT JOIN users u ON u.id = c.user_id`
	}
	q := `SELECT c.id, c.post_id, c.user_id, COALESCE(c.content,''), COALESCE(c.created_at,'')`
	if postJoin != "" {
		q += `, COALESCE(p.content,'')`
	} else {
		q += `, ''`
	}
	if userJoin != "" {
		q += `, COALESCE(u.username,'')`
	} else {
		q += `, ''`
	}
	q += ` FROM community_comments c` + postJoin + userJoin + ` ORDER BY c.id DESC LIMIT 200`
	rows, err := h.DB.Query(q)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"comments": []any{}})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, postID, userID int
		var content, created, postContent, username string
		if err := rows.Scan(&id, &postID, &userID, &content, &created, &postContent, &username); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "postId": postID, "userId": userID, "content": content,
			"createdAt": created, "postContent": postContent, "username": username,
		})
	}
	c.JSON(http.StatusOK, gin.H{"comments": list})
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
