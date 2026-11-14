// Copyright (c) 2026 heathcetide. All rights reserved.

package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/smtp"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func (s *Service) SendEmailVerification(userID int, password string) (map[string]any, error) {

	var email, hash sql.NullString
	var sessionVersion sql.NullInt64
	var disabled sql.NullInt64
	err := s.DB.QueryRow(`SELECT email, password_hash, session_version, COALESCE(is_disabled,0) FROM users WHERE id=?`, userID).
		Scan(&email, &hash, &sessionVersion, &disabled)
	if err != nil || !hash.Valid || disabled.Int64 == 1 || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(password)) != nil {
		return nil, apiErr(403, "请使用当前密码验证身份；无密码账号请使用已验证邮箱找回，或联系管理员", "EMAIL_REAUTH_REQUIRED")
	}
	if !email.Valid || !emailPattern.MatchString(email.String) {
		return nil, apiErr(400, "账号没有可验证的注册邮箱，请联系管理员", "EMAIL_REQUIRED")
	}
	return s.createAndDeliverChallenge(email.String, "email_verify", &userID, int(sessionVersion.Int64))
}

func (s *Service) SendEmailRecovery(emailAddr string) (map[string]any, error) {

	emailAddr = strings.ToLower(strings.TrimSpace(emailAddr))
	if !emailPattern.MatchString(emailAddr) {
		return nil, apiErr(400, "请输入有效邮箱", "INVALID_EMAIL")
	}
	var userID sql.NullInt64
	var sessionVersion sql.NullInt64
	var verified sql.NullString
	var disabled sql.NullInt64
	_ = s.DB.QueryRow(`SELECT id, session_version, email_verified_at, COALESCE(is_disabled,0) FROM users WHERE email=?`, emailAddr).
		Scan(&userID, &sessionVersion, &verified, &disabled)
	var uid *int
	var sv int
	if userID.Valid && verified.Valid && disabled.Int64 == 0 {
		id := int(userID.Int64)
		uid = &id
		sv = int(sessionVersion.Int64)
	}
	return s.createAndDeliverChallenge(emailAddr, "email_recovery", uid, sv)
}

func (s *Service) createAndDeliverChallenge(email, purpose string, userID *int, sessionVersion int) (map[string]any, error) {
	id := newUUID()
	code := fmt.Sprintf("%06d", secureInt(1000000))
	codeHash := s.emailCodeHash(id, purpose, code)
	expires := time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339Nano)
	var uid any
	var sv any
	if userID != nil {
		uid = *userID
		sv = sessionVersion
	}
	_, err := s.DB.Exec(`INSERT INTO email_auth_challenges (id,user_id,email,purpose,session_version,code_hash,status,expires_at)
		VALUES (?,?,?,?,?,?,'pending',?)`, id, uid, email, purpose, sv, codeHash, expires)
	if err != nil {
		return nil, err
	}
	if err := s.deliverEmail(email, code, purpose); err != nil {
		_, _ = s.DB.Exec(`UPDATE email_auth_challenges SET status='failed' WHERE id=?`, id)
		return nil, apiErr(503, "邮件发送失败，请稍后重试或使用其他恢复方式", "EMAIL_DELIVERY_FAILED")
	}
	_, _ = s.DB.Exec(`UPDATE email_auth_challenges SET status='sent' WHERE id=?`, id)
	return map[string]any{"challengeId": id, "resendAfter": 60, "expiresIn": 300}, nil
}

func (s *Service) deliverEmail(email, code, purpose string) error {
	action := "找回密码"
	if purpose == "email_verify" {
		action = "验证注册邮箱"
	}
	subject := "拾味日常" + action + "验证码"
	body := fmt.Sprintf("你的%s验证码是 %s，5 分钟内有效。不要向他人提供此验证码。收到验证码不代表账号具备恢复条件；非本人操作请忽略。", action, code)

	if cfg, ok := smtpConfigFromEnv(); ok {
		return sendSMTPText(cfg, email, subject, body)
	}

	// Without SMTP, production must fail closed. Dev may use the outbox.
	if isProductionEnv() {
		return errors.New("email delivery unavailable: configure SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM")
	}
	_, _ = s.DB.Exec(`INSERT INTO email_dev_outbox (email, purpose, code) VALUES (?, ?, ?)`, email, purpose, code)
	fmt.Fprintf(os.Stderr, "[email-dev] to=%s purpose=%s code=%s\n", email, purpose, code)
	return nil
}

type smtpConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	FromName string
}

func sendSMTPText(cfg smtpConfig, to, subject, body string) error {
	fromAddr := cfg.From
	fromHeader := cfg.From
	if cfg.FromName != "" && !strings.Contains(cfg.From, "<") {
		fromHeader = fmt.Sprintf("%s <%s>", cfg.FromName, cfg.From)
	}
	msg := strings.Builder{}
	fmt.Fprintf(&msg, "From: %s\r\n", fromHeader)
	fmt.Fprintf(&msg, "To: %s\r\n", to)
	fmt.Fprintf(&msg, "Subject: %s\r\n", subject)
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	msg.WriteString(body)
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	return smtp.SendMail(addr, auth, fromAddr, []string{to}, []byte(msg.String()))
}

func isProductionEnv() bool {
	env := strings.ToLower(strings.TrimSpace(firstNonEmptyEnv(
		os.Getenv("APP_APP_ENVIRONMENT"),
		os.Getenv("APP_ENVIRONMENT"),
		os.Getenv("NODE_ENV"),
	)))
	return env == "prod" || env == "production"
}

func smtpConfigFromEnv() (smtpConfig, bool) {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	user := strings.TrimSpace(os.Getenv("SMTP_USER"))
	pass := os.Getenv("SMTP_PASSWORD")
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	port := 587
	if raw := strings.TrimSpace(os.Getenv("SMTP_PORT")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 1 && n <= 65535 {
			port = n
		} else {
			return smtpConfig{}, false
		}
	}
	if host == "" || user == "" || pass == "" || from == "" || !strings.Contains(from, "@") {
		return smtpConfig{}, false
	}
	return smtpConfig{
		Host: host, Port: port, Username: user, Password: pass, From: from, FromName: "拾味日常",
	}, true
}

func firstNonEmptyEnv(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func (s *Service) VerifyEmailChallenge(challengeID, code, purpose string, userID *int) (map[string]any, error) {

	codeHash := s.emailCodeHash(challengeID, purpose, code)
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var challengeUserID sql.NullInt64
	var email string
	var sessionVersion sql.NullInt64
	var storedHash string
	q := `UPDATE email_auth_challenges SET attempts=attempts+1
		WHERE id=? AND purpose=? AND status='sent' AND attempts<5 AND expires_at > ?`
	args := []any{challengeID, purpose, time.Now().UTC().Format(time.RFC3339Nano)}
	if userID != nil {
		q += ` AND (user_id IS NULL OR user_id=?)`
		args = append(args, *userID)
	}
	if s.DB.Dialect == "mysql" {
		res, execErr := tx.Exec(q, args...)
		if execErr != nil {
			return nil, execErr
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return nil, apiErr(400, "验证码错误或已失效，或账号不具备恢复条件", "EMAIL_CODE_INVALID")
		}
		err = tx.QueryRow(`SELECT user_id, email, session_version, code_hash FROM email_auth_challenges WHERE id=?`, challengeID).
			Scan(&challengeUserID, &email, &sessionVersion, &storedHash)
	} else {
		q += ` RETURNING user_id, email, session_version, code_hash`
		err = tx.QueryRow(q, args...).Scan(&challengeUserID, &email, &sessionVersion, &storedHash)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apiErr(400, "验证码错误或已失效，或账号不具备恢复条件", "EMAIL_CODE_INVALID")
	}
	if err != nil {
		return nil, err
	}

	if storedHash != codeHash {
		_ = tx.Commit()
		return nil, apiErr(400, "验证码错误或已失效，或账号不具备恢复条件", "EMAIL_CODE_INVALID")
	}
	if !challengeUserID.Valid {
		_ = tx.Commit()
		return nil, apiErr(400, "验证码错误或已失效，或账号不具备恢复条件", "EMAIL_CODE_INVALID")
	}
	uid := int(challengeUserID.Int64)

	secret := randomToken(32)
	recoveryHash := hashRecoveryToken("email:" + secret)
	recoveryExpires := time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339Nano)
	if purpose == "email_verify" {
		_, _ = tx.Exec(`UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?`, uid)
		_, _ = tx.Exec(`UPDATE email_auth_challenges SET status='consumed' WHERE id=?`, challengeID)
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"success": true}, nil
	}
	_, _ = tx.Exec(`UPDATE email_auth_challenges SET status='verified', recovery_hash=?, recovery_expires_at=? WHERE id=?`,
		recoveryHash, recoveryExpires, challengeID)
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"recoveryToken": fmt.Sprintf("%d.%s", uid, secret), "expiresIn": 300}, nil
}

func (s *Service) RecoverPassword(recoveryToken, newPassword, channel string) (map[string]any, error) {
	if channel != "email" {
		return nil, apiErr(400, "仅支持邮箱找回密码", "INVALID_RECOVERY_CHANNEL")
	}
	if !validPassword(newPassword) {
		return nil, apiErr(400, "密码需至少 8 位且包含字母与数字", "INVALID_PASSWORD")
	}
	invalid := func() error {
		return apiErr(403, "恢复凭据已失效，请重新验证邮箱", "PASSWORD_RECOVERY_INVALID")
	}
	parts := regexp.MustCompile(`^([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$`).FindStringSubmatch(recoveryToken)
	if parts == nil {
		return nil, invalid()
	}
	userID, err := strconv.Atoi(parts[1])
	if err != nil {
		return nil, invalid()
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	query := `SELECT session_version FROM users WHERE id=? AND COALESCE(is_disabled,0)=0`
	if s.DB.Dialect == "postgresql" || s.DB.Dialect == "mysql" {
		query += " FOR UPDATE"
	}
	var sessionVersion int
	if err := tx.QueryRow(query, userID).Scan(&sessionVersion); errors.Is(err, sql.ErrNoRows) {
		return nil, invalid()
	} else if err != nil {
		return nil, err
	}
	var proofUser int
	recoveryHashArg := hashRecoveryToken("email:" + parts[2])
	recoveryNow := time.Now().UTC().Format(time.RFC3339Nano)
	consumeSQL := `UPDATE email_auth_challenges SET status='consumed'
  WHERE recovery_hash=? AND user_id=? AND purpose='email_recovery' AND status='verified' AND recovery_expires_at>?
  AND EXISTS(SELECT 1 FROM users u WHERE u.id=email_auth_challenges.user_id AND u.email=email_auth_challenges.email
   AND u.email_verified_at IS NOT NULL AND u.session_version=email_auth_challenges.session_version AND COALESCE(u.is_disabled,0)=0)`
	if s.DB.Dialect == "mysql" {
		res, execErr := tx.Exec(consumeSQL, recoveryHashArg, userID, recoveryNow)
		if execErr != nil {
			return nil, execErr
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return nil, invalid()
		}
		proofUser = userID
	} else {
		err = tx.QueryRow(consumeSQL+` RETURNING user_id`, recoveryHashArg, userID, recoveryNow).Scan(&proofUser)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, invalid()
		}
		if err != nil {
			return nil, err
		}
	}
	result, err := tx.Exec(`UPDATE users SET password_hash=?, must_change_password=0, session_version=session_version+1 WHERE id=? AND session_version=?`, string(newHash), userID, sessionVersion)
	if err != nil {
		return nil, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, invalid()
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"success": true, "message": "密码已重设，请使用新密码重新登录"}, nil
}

func (s *Service) ExportAIData(userID int) (map[string]any, error) {
	conversations := make([]map[string]any, 0)
	rows, err := s.DB.Query(`SELECT session_id, role, content, COALESCE(created_at,'') FROM ai_chat_messages WHERE user_id=? ORDER BY id`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sessionID, role, content, created string
			if rows.Scan(&sessionID, &role, &content, &created) == nil {
				conversations = append(conversations, map[string]any{
					"sessionId": sessionID, "role": role, "content": content, "createdAt": created,
				})
			}
		}
	}
	return map[string]any{"conversations": conversations, "usage": []any{}}, nil
}

func (s *Service) DeleteAIData(userID int) (map[string]any, error) {
	_, _ = s.DB.Exec(`DELETE FROM ai_chat_messages WHERE user_id=?`, userID)
	_, _ = s.DB.Exec(`DELETE FROM ai_usage_logs WHERE user_id=?`, userID)
	return map[string]any{"deleted": true}, nil
}

func (s *Service) DeleteAccount(userID int, password string) (map[string]any, error) {
	var hash sql.NullString
	var role string
	if err := s.DB.QueryRow(`SELECT password_hash, role FROM users WHERE id=?`, userID).Scan(&hash, &role); err != nil {
		return nil, apiErr(404, "用户不存在", "USER_NOT_FOUND")
	}
	if role == "admin" {
		return nil, apiErr(403, "管理员账号不能通过客户端注销", "ADMIN_ACCOUNT_DELETE_FORBIDDEN")
	}
	if !hash.Valid || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(password)) != nil {
		return nil, apiErr(403, "密码不正确", "INVALID_PASSWORD")
	}
	urls := s.accountMediaURLs(userID)
	var cleanupJobID any
	if len(urls) > 0 && s.DB.HasTable("media_cleanup_jobs") {
		urlsJSON, _ := json.Marshal(urls)
		id, err := s.DB.InsertID(`INSERT INTO media_cleanup_jobs (owner_user_id, urls_json, status)
			VALUES (?, ?, 'pending')`, userID, string(urlsJSON))
		if err == nil {
			cleanupJobID = id
		}
	}
	_, err := s.DB.Exec(`DELETE FROM users WHERE id=?`, userID)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"deleted": true}
	if cleanupJobID != nil {
		out["cleanupJobId"] = cleanupJobID
	}
	return out, nil
}

func (s *Service) accountMediaURLs(userID int) []string {
	urls := make([]string, 0)
	seen := map[string]struct{}{}
	add := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return
		}
		if _, ok := seen[raw]; ok {
			return
		}
		seen[raw] = struct{}{}
		urls = append(urls, raw)
	}
	if s.DB.HasTable("community_posts") {
		hasImage := s.DB.HasColumn("community_posts", "image_url")
		hasList := s.DB.HasColumn("community_posts", "image_urls")
		if hasImage || hasList {
			imageExpr, listExpr := "''", "''"
			if hasImage {
				imageExpr = "COALESCE(image_url,'')"
			}
			if hasList {
				listExpr = "COALESCE(image_urls,'')"
			}
			rows, err := s.DB.Query(`SELECT `+imageExpr+`, `+listExpr+` FROM community_posts WHERE user_id=?`, userID)
			if err == nil {
				for rows.Next() {
					var imageURL, imageURLs string
					if rows.Scan(&imageURL, &imageURLs) != nil {
						continue
					}
					add(imageURL)
					var list []any
					if json.Unmarshal([]byte(imageURLs), &list) == nil {
						for _, item := range list {
							if s, ok := item.(string); ok {
								add(s)
							}
						}
					}
				}
				_ = rows.Close()
			}
		}
	}
	if s.DB.HasTable("community_comments") && s.DB.HasColumn("community_comments", "image_url") {
		rows, err := s.DB.Query(`SELECT COALESCE(image_url,'') FROM community_comments WHERE user_id=?`, userID)
		if err == nil {
			for rows.Next() {
				var imageURL string
				if rows.Scan(&imageURL) == nil {
					add(imageURL)
				}
			}
			_ = rows.Close()
		}
	}
	return urls
}

func (s *Service) emailCodeHash(id, purpose, code string) string {
	mac := hmac.New(sha256.New, s.Auth.Secret)
	_, _ = mac.Write([]byte("email-code:" + id + ":" + purpose + ":" + code))
	return hex.EncodeToString(mac.Sum(nil))
}

func hashRecoveryToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func secureInt(mod int) int {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	v := int(b[0])<<24 | int(b[1])<<16 | int(b[2])<<8 | int(b[3])
	if v < 0 {
		v = -v
	}
	return v % mod
}
