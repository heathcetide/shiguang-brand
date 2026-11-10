// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
	"golang.org/x/crypto/bcrypt"
)

func (h *Handlers) ListUsers(c *gin.Context) {
	hasExpert := h.hasColumn("users", "is_verified_expert")
	q := `SELECT id, username, email, phone, role, COALESCE(is_disabled,0), created_at`
	if hasExpert {
		q += `, COALESCE(is_verified_expert,0)`
	} else {
		q += `, 0`
	}
	q += ` FROM users ORDER BY id DESC LIMIT 200`
	rows, err := h.DB.Query(q)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取用户失败", "ADMIN_USERS_FAILED")
		return
	}
	defer rows.Close()
	users := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var username string
		var email, phone, role, created sql.NullString
		var disabled, expert int
		if err := rows.Scan(&id, &username, &email, &phone, &role, &disabled, &created, &expert); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取用户失败", "ADMIN_USERS_FAILED")
			return
		}
		users = append(users, map[string]any{
			"id": id, "username": username, "email": nullStr(email), "phone": nullStr(phone),
			"role": nullStr(role), "is_disabled": boolNum(disabled), "is_verified_expert": boolNum(expert),
			"created_at": nullStr(created),
		})
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func (h *Handlers) UserHealthProfileGet(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if !h.hasTable("user_health_profiles") {
		c.JSON(http.StatusOK, gin.H{"profile": nil})
		return
	}
	var raw sql.NullString
	err := h.DB.QueryRow(`SELECT profile_json FROM user_health_profiles WHERE user_id=?`, id).Scan(&raw)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, gin.H{"profile": nil})
		return
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取健康档案失败", "HEALTH_PROFILE_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": parseJSONMap(raw.String), "userId": id})
}

func (h *Handlers) UserRolePut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if !bindJSON(c, &body) {
		return
	}
	if body.Role != "user" && body.Role != "admin" {
		httpx.SendError(c, http.StatusBadRequest, "无效的角色", "INVALID_ROLE")
		return
	}
	_, err := h.DB.Exec(`UPDATE users SET role=? WHERE id=?`, body.Role, id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新角色失败", "USER_ROLE_FAILED")
		return
	}
	h.recordAudit(c, "user.role.update", "user", strconv.Itoa(id), "更新用户角色")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) UserStatusPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		IsDisabled bool `json:"is_disabled"`
	}
	if !bindJSON(c, &body) {
		return
	}
	disabled := 0
	if body.IsDisabled {
		disabled = 1
	}
	_, err := h.DB.Exec(`UPDATE users SET is_disabled=? WHERE id=?`, disabled, id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新状态失败", "USER_STATUS_FAILED")
		return
	}
	h.recordAudit(c, "user.status.update", "user", strconv.Itoa(id), "更新用户状态")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func adminValidPassword(password string) bool {
	if len(password) < 8 || len(password) > 72 {
		return false
	}
	var hasLetter, hasDigit bool
	for _, r := range password {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
	}
	return hasLetter && hasDigit
}

func (h *Handlers) UserCredentialsPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		Password    *string `json:"password"`
		NewPassword *string `json:"newPassword"`
	}
	if !bindJSON(c, &body) {
		return
	}
	plain := ""
	if body.NewPassword != nil {
		plain = strings.TrimSpace(*body.NewPassword)
	}
	if plain == "" && body.Password != nil {
		plain = strings.TrimSpace(*body.Password)
	}
	if plain == "" {
		httpx.SendError(c, http.StatusBadRequest, "密码不能为空", "INVALID_PASSWORD")
		return
	}
	if !adminValidPassword(plain) {
		httpx.SendError(c, http.StatusBadRequest, "密码需至少 8 位且包含字母与数字", "INVALID_PASSWORD")
		return
	}
	var exists int
	err := h.DB.QueryRow(`SELECT 1 FROM users WHERE id=?`, id).Scan(&exists)
	if err == sql.ErrNoRows {
		httpx.SendError(c, http.StatusNotFound, "未找到该用户", "USER_NOT_FOUND")
		return
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新凭据失败", "USER_CREDENTIALS_FAILED")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), 12)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新凭据失败", "USER_CREDENTIALS_FAILED")
		return
	}
	res, err := h.DB.Exec(`UPDATE users SET password_hash=?, session_version=session_version+1, must_change_password=0 WHERE id=?`,
		string(hash), id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新凭据失败", "USER_CREDENTIALS_FAILED")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.SendError(c, http.StatusNotFound, "未找到该用户", "USER_NOT_FOUND")
		return
	}
	h.recordAudit(c, "user.credentials.update", "user", strconv.Itoa(id), "管理员重置用户密码")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) UserExpertPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		IsVerifiedExpert bool `json:"is_verified_expert"`
	}
	if !bindJSON(c, &body) {
		return
	}
	if !h.hasColumn("users", "is_verified_expert") {
		okJSON(c)
		return
	}
	v := 0
	if body.IsVerifiedExpert {
		v = 1
	}
	_, err := h.DB.Exec(`UPDATE users SET is_verified_expert=? WHERE id=?`, v, id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新专家状态失败", "USER_EXPERT_FAILED")
		return
	}
	h.recordAudit(c, "user.expert.update", "user", strconv.Itoa(id), "更新专家认证")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) UserLevelAdjustmentPost(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.recordAudit(c, "user.level_adjustment", "user", strconv.Itoa(id), "用户等级调整")
	okJSON(c)
}
