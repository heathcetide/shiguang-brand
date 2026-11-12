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
	page, pageSize, offset := parsePageParams(c, 50, 200)
	search := strings.TrimSpace(c.Query("search"))
	if search == "" {
		search = strings.TrimSpace(c.Query("q"))
	}
	role := strings.TrimSpace(c.Query("role"))
	hasExpert := h.hasColumn("users", "is_verified_expert")

	where := []string{"1=1"}
	args := make([]any, 0)
	if search != "" {
		where = append(where, "(username LIKE ? OR COALESCE(email,'') LIKE ? OR COALESCE(phone,'') LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	switch role {
	case "admin", "user":
		where = append(where, "role=?")
		args = append(args, role)
	case "expert":
		if hasExpert {
			where = append(where, "COALESCE(is_verified_expert,0)=1")
		}
	case "disabled":
		where = append(where, "COALESCE(is_disabled,0)=1")
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE `+whereSQL, args...).Scan(&total)

	q := `SELECT id, username, email, phone, role, COALESCE(is_disabled,0), created_at`
	if hasExpert {
		q += `, COALESCE(is_verified_expert,0)`
	} else {
		q += `, 0`
	}
	q += ` FROM users WHERE ` + whereSQL + ` ORDER BY id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := h.DB.Query(q, queryArgs...)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取用户失败", "ADMIN_USERS_FAILED")
		return
	}
	defer rows.Close()
	users := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var username string
		var email, phone, roleName, created sql.NullString
		var disabled, expert int
		if err := rows.Scan(&id, &username, &email, &phone, &roleName, &disabled, &created, &expert); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取用户失败", "ADMIN_USERS_FAILED")
			return
		}
		users = append(users, map[string]any{
			"id": id, "username": username, "email": nullStr(email), "phone": nullStr(phone),
			"role": nullStr(roleName), "is_disabled": boolNum(disabled), "is_verified_expert": boolNum(expert),
			"created_at": nullStr(created),
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"items": users, "users": users, "total": total, "page": page, "pageSize": pageSize, "nextCursor": nil,
	})
}

func (h *Handlers) UserHealthProfileGet(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	response := gin.H{
		"user_id":         id,
		"userId":          id,
		"profile":         nil,
		"latest_tracking": nil,
		"tracking_count":  0,
	}
	if !h.hasTable("user_health_profiles") {
		c.JSON(http.StatusOK, response)
		return
	}
	var raw sql.NullString
	err := h.DB.QueryRow(`SELECT profile_json FROM user_health_profiles WHERE user_id=?`, id).Scan(&raw)
	if err != nil && err != sql.ErrNoRows {
		httpx.SendError(c, http.StatusInternalServerError, "读取健康档案失败", "HEALTH_PROFILE_FAILED")
		return
	}
	if err == nil && raw.Valid && strings.TrimSpace(raw.String) != "" && strings.TrimSpace(raw.String) != "{}" {
		parsed := parseJSONMap(raw.String)
		if len(parsed) > 0 {
			response["profile"] = parsed
		}
	}
	if h.hasTable("health_logs") {
		var count int
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM health_logs WHERE user_id=?`, id).Scan(&count)
		response["tracking_count"] = count
		if count > 0 {
			cols := []string{}
			for _, col := range []string{
				"recorded_date", "weight", "body_fat", "waist_cm",
				"blood_pressure_systolic", "blood_pressure_diastolic",
				"blood_glucose_mmol", "sleep_hours", "cycle_status",
			} {
				if h.hasColumn("health_logs", col) {
					cols = append(cols, col)
				}
			}
			if len(cols) > 0 {
				order := "id DESC"
				if h.hasColumn("health_logs", "recorded_date") {
					order = "recorded_date DESC, id DESC"
				}
				row := h.queryOne(`SELECT `+strings.Join(cols, ", ")+` FROM health_logs WHERE user_id=? ORDER BY `+order+` LIMIT 1`, id)
				if row != nil {
					response["latest_tracking"] = row
				}
			}
		}
	}
	c.JSON(http.StatusOK, response)
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
