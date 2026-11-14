// Copyright (c) 2026 heathcetide. All rights reserved.

package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"golang.org/x/crypto/bcrypt"
)

var (
	emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	phonePattern = regexp.MustCompile(`^1[3-9]\d{9}$`)
)

// Service implements Express authAccount login/register/me essentials.
type Service struct {
	DB   *dbx.DB
	Auth *expressauth.Auth
}

type APIError struct {
	Status             int
	Message            string
	Code               string
	RecordLoginFailure bool
}

func (e *APIError) Error() string { return e.Message }

func apiErr(status int, message, code string, recordFailure ...bool) *APIError {
	err := &APIError{Status: status, Message: message, Code: code}
	if len(recordFailure) > 0 {
		err.RecordLoginFailure = recordFailure[0]
	}
	return err
}

type identifier struct {
	Raw   string
	Email *string
	Phone *string
}

func parseIdentifier(value string) identifier {
	raw := strings.ToLower(strings.TrimSpace(value))
	id := identifier{Raw: raw}
	if emailPattern.MatchString(raw) {
		id.Email = &raw
		return id
	}
	if phonePattern.MatchString(raw) {
		id.Phone = &raw
		return id
	}
	return id
}

func validPassword(password string) bool {
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

func (s *Service) Register(identifierValue, username, password string) (map[string]any, error) {
	parsed := parseIdentifier(identifierValue)
	if parsed.Email == nil && parsed.Phone == nil {
		return nil, apiErr(400, "请输入有效的邮箱或手机号", "INVALID_IDENTIFIER")
	}
	if parsed.Phone != nil {
		return nil, apiErr(400, "仅支持邮箱注册", "EMAIL_REGISTRATION_ONLY")
	}
	if !validPassword(password) {
		return nil, apiErr(400, "密码需至少 8 位且包含字母与数字", "INVALID_PASSWORD")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, apiErr(400, "用户名不能为空", "INVALID_USERNAME")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM users WHERE email = ? OR phone = ? LIMIT 1`, parsed.Email, parsed.Phone).Scan(&exists); err == nil {
		return nil, apiErr(409, "该邮箱或手机号已注册", "IDENTIFIER_EXISTS")
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err := tx.QueryRow(`SELECT 1 FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1`, username).Scan(&exists); err == nil {
		return nil, apiErr(409, "该用户名已被使用", "USERNAME_EXISTS")
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	userID64, err := tx.InsertID(`INSERT INTO users (username, email, phone, password_hash, avatar_url, daily_calories_target)
		VALUES (?, ?, ?, ?, NULL, NULL)`, username, parsed.Email, parsed.Phone, string(hash))
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "users.username") {
			return nil, apiErr(409, "该用户名已被使用", "USERNAME_EXISTS")
		}
		if strings.Contains(msg, "users.email") || strings.Contains(msg, "users.phone") {
			return nil, apiErr(409, "该邮箱或手机号已注册", "IDENTIFIER_EXISTS")
		}
		return nil, err
	}

	userID := int(userID64)
	_ = s.ensureInitialStateTx(tx, userID)

	var user map[string]any
	user, sessionVersion, err := s.loadCreatedUser(tx, userID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = s.recordFunnel(userID, "account_registered")
	token, err := s.Auth.Sign(userID, sessionVersion)
	if err != nil {
		return nil, err
	}
	return map[string]any{"token": token, "user": user}, nil
}

func (s *Service) Login(identifierValue, password, clientIP, userAgent string) (map[string]any, error) {
	parsed := parseIdentifier(identifierValue)
	rawID := strings.TrimSpace(parsed.Raw)
	// Admin console may submit email, phone, or an admin username (e.g. local_admin / admin).
	looksLikeUsername := parsed.Email == nil && parsed.Phone == nil && rawID != ""
	if (parsed.Email == nil && parsed.Phone == nil && !looksLikeUsername) || strings.TrimSpace(password) == "" {
		return nil, apiErr(400, "请输入管理员账号，或注册时的邮箱/手机号", "INVALID_IDENTIFIER", true)
	}

	var (
		id                                         int
		username, role                             string
		email, phone, passwordHash, avatarURL, bio sql.NullString
		mustChange, sessionVersion, dailyCalories  sql.NullInt64
		createdAt, lastLoginAt, lastLoginIP        sql.NullString
		isDisabled, isVerifiedExpert               sql.NullInt64
	)
	selectSQL := `SELECT id,username,email,phone,password_hash,avatar_url,bio,role,must_change_password,
		session_version,daily_calories_target,created_at,is_disabled,is_verified_expert,last_login_at,last_login_ip FROM users `
	var row *sql.Row
	if looksLikeUsername {
		row = s.DB.QueryRow(selectSQL+`WHERE username=? AND role='admin'`, rawID)
	} else {
		row = s.DB.QueryRow(selectSQL+`WHERE email=? OR phone=?`, parsed.Email, parsed.Phone)
	}
	err := row.Scan(&id, &username, &email, &phone, &passwordHash, &avatarURL, &bio, &role, &mustChange,
		&sessionVersion, &dailyCalories, &createdAt, &isDisabled, &isVerifiedExpert, &lastLoginAt, &lastLoginIP)
	if errors.Is(err, sql.ErrNoRows) || !passwordHash.Valid || passwordHash.String == "" {
		return nil, apiErr(401, "账号、邮箱、手机号或密码错误", "INVALID_CREDENTIALS", true)
	}
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)) != nil {
		return nil, apiErr(401, "账号、邮箱、手机号或密码错误", "INVALID_CREDENTIALS", true)
	}
	if isDisabled.Valid && isDisabled.Int64 == 1 {
		return nil, apiErr(403, "账号已被停用", "ACCOUNT_DISABLED")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	sv := int(sessionVersion.Int64)
	if sv < 1 {
		sv = 1
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var returnedSV sql.NullInt64
	if s.DB.Dialect == "mysql" {
		res, execErr := tx.Exec(`UPDATE users SET last_login_at=?, last_login_ip=?
			WHERE id=? AND password_hash=? AND session_version=? AND COALESCE(is_disabled,0)=0`,
			now, clientIP, id, passwordHash.String, sv)
		if execErr != nil {
			return nil, execErr
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return nil, apiErr(401, "账号、邮箱、手机号或密码错误", "INVALID_CREDENTIALS", true)
		}
		err = tx.QueryRow(`SELECT session_version FROM users WHERE id=?`, id).Scan(&returnedSV)
	} else {
		err = tx.QueryRow(`UPDATE users SET last_login_at=?, last_login_ip=?
			WHERE id=? AND password_hash=? AND session_version=? AND COALESCE(is_disabled,0)=0
			RETURNING session_version`, now, clientIP, id, passwordHash.String, sv).Scan(&returnedSV)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apiErr(401, "账号、邮箱、手机号或密码错误", "INVALID_CREDENTIALS", true)
	}
	if err != nil {
		return nil, err
	}

	_ = s.ensureInitialStateTx(tx, id)
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	finalSV := int(returnedSV.Int64)
	if finalSV < 1 {
		finalSV = 1
	}
	if role != "admin" {
		_ = s.recordFunnel(id, "login_succeeded")
	} else {
		_, _ = s.DB.Exec(`INSERT INTO admin_audit_logs (admin_user_id,action,resource_type,resource_id,summary,ip_address,user_agent)
			VALUES (?,?,?,?,?,?,?)`, id, "auth.login", "session", id, "管理员登录成功", clientIP, nullIfEmpty(userAgent))
	}

	token, err := s.Auth.Sign(id, finalSV)
	if err != nil {
		return nil, err
	}
	user := map[string]any{
		"id": id, "username": username, "email": nullStr(email), "phone": nullStr(phone),
		"avatar_url": nullStr(avatarURL), "bio": nullStr(bio), "role": role,
		"must_change_password": boolNum(mustChange), "daily_calories_target": nullInt(dailyCalories),
		"created_at": nullStr(createdAt), "is_disabled": boolNum(isDisabled),
		"is_verified_expert": boolNum(isVerifiedExpert), "hasPassword": true,
		"last_login_at": now, "last_login_ip": clientIP,
	}
	return map[string]any{"token": token, "user": user}, nil
}

func (s *Service) Me(userID int) (map[string]any, error) {
	var (
		id                                 int
		username                           string
		email, phone, avatarURL, bio, role sql.NullString
		emailVerified, createdAt           sql.NullString
		lastLoginAt, lastLoginIP           sql.NullString
		dailyCalories, mustChange          sql.NullInt64
		hasPassword                        int
	)
	err := s.DB.QueryRow(`SELECT id,username,email,phone,email_verified_at,avatar_url,bio,
		daily_calories_target,created_at,role,must_change_password,last_login_at,last_login_ip,
		CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END
		FROM users WHERE id=?`, userID).Scan(
		&id, &username, &email, &phone, &emailVerified, &avatarURL, &bio,
		&dailyCalories, &createdAt, &role, &mustChange, &lastLoginAt, &lastLoginIP, &hasPassword)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apiErr(404, "用户不存在", "USER_NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "username": username, "email": nullStr(email), "phone": nullStr(phone),
		"email_verified_at": nullStr(emailVerified),
		"avatar_url":        nullStr(avatarURL), "bio": nullStr(bio),
		"daily_calories_target": nullInt(dailyCalories), "created_at": nullStr(createdAt),
		"role": nullStr(role), "must_change_password": boolNum(mustChange),
		"last_login_at": nullStr(lastLoginAt), "last_login_ip": nullStr(lastLoginIP),
		"hasPassword": hasPassword == 1,
	}, nil
}

func (s *Service) UpdateProfile(userID int, body map[string]any) (map[string]any, error) {
	username, _ := body["username"].(string)
	username = strings.TrimSpace(username)
	nickname, hasNickname := body["nickname"].(string)
	bio, hasBio := body["bio"].(string)
	avatar, hasAvatar := body["avatar_url"].(string)

	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if username != "" {
		var exists int
		if err := tx.QueryRow(`SELECT 1 FROM users WHERE LOWER(username)=LOWER(?) AND id<>?`, username, userID).Scan(&exists); err == nil {
			return nil, apiErr(409, "该用户名已被使用", "USERNAME_EXISTS")
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if _, err := tx.Exec(`UPDATE users SET username=? WHERE id=?`, username, userID); err != nil {
			return nil, err
		}
	}
	if hasBio {
		if _, err := tx.Exec(`UPDATE users SET bio=? WHERE id=?`, strings.TrimSpace(bio), userID); err != nil {
			return nil, err
		}
	}
	if hasAvatar {
		if _, err := tx.Exec(`UPDATE users SET avatar_url=? WHERE id=?`, strings.TrimSpace(avatar), userID); err != nil {
			return nil, err
		}
	}
	if hasNickname {
		// nickname column may exist depending on migration; ignore if missing.
		_, _ = tx.Exec(`UPDATE users SET nickname=? WHERE id=?`, strings.TrimSpace(nickname), userID)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Me(userID)
}

func (s *Service) ChangePassword(userID int, currentPassword, newPassword string) (map[string]any, error) {
	if strings.TrimSpace(currentPassword) == "" || strings.TrimSpace(newPassword) == "" {
		return nil, apiErr(400, "当前密码和新密码不能为空", "INVALID_PASSWORD")
	}
	if !validPassword(newPassword) {
		return nil, apiErr(400, "密码需至少 8 位且包含字母与数字", "INVALID_PASSWORD")
	}
	var hash sql.NullString
	var role sql.NullString
	if err := s.DB.QueryRow(`SELECT password_hash, role FROM users WHERE id=?`, userID).Scan(&hash, &role); err != nil {
		return nil, apiErr(400, "当前密码不正确", "INVALID_PASSWORD")
	}
	if !hash.Valid || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(currentPassword)) != nil {
		return nil, apiErr(400, "当前密码不正确", "INVALID_PASSWORD")
	}
	if bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(newPassword)) == nil {
		return nil, apiErr(400, "新密码不能与当前密码相同", "INVALID_PASSWORD")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return nil, err
	}
	res, err := s.DB.Exec(`UPDATE users SET password_hash=?, must_change_password=0, session_version=session_version+1 WHERE id=?`, string(newHash), userID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, apiErr(400, "当前密码不正确", "INVALID_PASSWORD")
	}
	return map[string]any{"success": true, "message": "密码修改成功"}, nil
}

func (s *Service) loadCreatedUser(tx *dbx.Tx, userID int) (map[string]any, int, error) {
	var (
		id                            int
		username                      string
		email, phone, avatarURL, bio  sql.NullString
		dailyCalories, sessionVersion sql.NullInt64
		hasPassword                   int
	)
	err := tx.QueryRow(`SELECT id,username,email,phone,avatar_url,bio,daily_calories_target,session_version,
		CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END
		FROM users WHERE id=?`, userID).Scan(&id, &username, &email, &phone, &avatarURL, &bio, &dailyCalories, &sessionVersion, &hasPassword)
	if err != nil {
		return nil, 0, err
	}
	sv := int(sessionVersion.Int64)
	if sv < 1 {
		sv = 1
	}
	return map[string]any{
		"id": id, "username": username, "email": nullStr(email), "phone": nullStr(phone),
		"avatar_url": nullStr(avatarURL), "bio": nullStr(bio),
		"daily_calories_target": nullInt(dailyCalories), "hasPassword": hasPassword == 1,
	}, sv, nil
}

func (s *Service) ensureInitialStateTx(tx *dbx.Tx, userID int) error {
	// Best-effort mirrors Express ensureInitialState for health profile row.
	_, _ = tx.Exec(`INSERT INTO user_health_profiles (user_id) VALUES (?) ON CONFLICT DO NOTHING`, userID)
	return nil
}

func (s *Service) recordFunnel(userID int, event string) error {
	mac := hmac.New(sha256.New, s.Auth.Secret)
	_, _ = mac.Write([]byte("user:" + itoa(userID)))
	hash := hex.EncodeToString(mac.Sum(nil))
	_, err := s.DB.Exec(`INSERT INTO funnel_events (event_name, actor_hash) VALUES (?, ?)`, event, hash)
	return err
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func nullStr(v sql.NullString) any {
	if !v.Valid {
		return nil
	}
	return v.String
}

func nullInt(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}

func boolNum(v sql.NullInt64) any {
	if !v.Valid {
		return 0
	}
	return v.Int64
}

func nullIfEmpty(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}
