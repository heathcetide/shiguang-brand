// Copyright (c) 2026 heathcetide. All rights reserved.

package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func (s *Service) ensureEmailTables() {
	_, _ = s.DB.Exec(`CREATE TABLE IF NOT EXISTS email_auth_challenges (
		id TEXT PRIMARY KEY,
		user_id INTEGER,
		email TEXT NOT NULL,
		purpose TEXT NOT NULL,
		session_version INTEGER,
		code_hash TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		attempts INTEGER NOT NULL DEFAULT 0,
		recovery_hash TEXT,
		recovery_expires_at TEXT,
		expires_at TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
}

func (s *Service) SendEmailVerification(userID int, password string) (map[string]any, error) {
	s.ensureEmailTables()
	var email, hash sql.NullString
	var sessionVersion sql.NullInt64
	var disabled sql.NullInt64
	err := s.DB.QueryRow(`SELECT email, password_hash, session_version, COALESCE(is_disabled,0) FROM users WHERE id=?`, userID).
		Scan(&email, &hash, &sessionVersion, &disabled)
	if err != nil || !hash.Valid || disabled.Int64 == 1 || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(password)) != nil {
		return nil, apiErr(403, "请使用当前密码验证身份；无密码账号请先设置密码", "EMAIL_REAUTH_REQUIRED")
	}
	if !email.Valid || !emailPattern.MatchString(email.String) {
		return nil, apiErr(400, "账号没有可验证的注册邮箱，请使用绑定手机", "EMAIL_REQUIRED")
	}
	return s.createAndDeliverChallenge(email.String, "email_verify", &userID, int(sessionVersion.Int64))
}

func (s *Service) SendEmailRecovery(emailAddr string) (map[string]any, error) {
	s.ensureEmailTables()
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
	// Dev/local: always succeed and persist last code for operators.
	_, _ = s.DB.Exec(`CREATE TABLE IF NOT EXISTS email_dev_outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT, purpose TEXT, code TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	_, _ = s.DB.Exec(`INSERT INTO email_dev_outbox (email, purpose, code) VALUES (?, ?, ?)`, email, purpose, code)
	fmt.Fprintf(os.Stderr, "[email-dev] to=%s purpose=%s code=%s\n", email, purpose, code)
	return nil
}

func (s *Service) VerifyEmailChallenge(challengeID, code, purpose string, userID *int) (map[string]any, error) {
	s.ensureEmailTables()
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
		WHERE id=? AND purpose=? AND status='sent' AND attempts<5 AND expires_at > datetime('now')`
	args := []any{challengeID, purpose}
	if userID != nil {
		q += ` AND (user_id IS NULL OR user_id=?)`
		args = append(args, *userID)
	}
	q += ` RETURNING user_id, email, session_version, code_hash`
	err = tx.QueryRow(q, args...).Scan(&challengeUserID, &email, &sessionVersion, &storedHash)
	if err != nil {
		// fallback without RETURNING
		row := tx.QueryRow(`SELECT user_id, email, session_version, code_hash, status, attempts, expires_at
			FROM email_auth_challenges WHERE id=? AND purpose=?`, challengeID, purpose)
		var status string
		var attempts int
		var expires string
		if scanErr := row.Scan(&challengeUserID, &email, &sessionVersion, &storedHash, &status, &attempts, &expires); scanErr != nil {
			return nil, apiErr(400, "验证码错误或已失效，或账号不具备恢复条件", "EMAIL_CODE_INVALID")
		}
		if status != "sent" || attempts >= 5 {
			return nil, apiErr(400, "验证码错误或已失效，或账号不具备恢复条件", "EMAIL_CODE_INVALID")
		}
		_, _ = tx.Exec(`UPDATE email_auth_challenges SET attempts=attempts+1 WHERE id=?`, challengeID)
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
	if !validPassword(newPassword) {
		return nil, apiErr(400, "密码需至少 8 位且包含字母与数字", "INVALID_PASSWORD")
	}
	parts := strings.SplitN(recoveryToken, ".", 2)
	if len(parts) != 2 {
		return nil, apiErr(403, "恢复凭据已失效，请重新验证恢复方式", "PASSWORD_RECOVERY_INVALID")
	}
	var userID int
	if _, err := fmt.Sscanf(parts[0], "%d", &userID); err != nil || userID <= 0 {
		return nil, apiErr(403, "恢复凭据已失效，请重新验证恢复方式", "PASSWORD_RECOVERY_INVALID")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return nil, err
	}
	if channel == "email" {
		s.ensureEmailTables()
		want := hashRecoveryToken("email:" + parts[1])
		var ok int
		err := s.DB.QueryRow(`SELECT 1 FROM email_auth_challenges
			WHERE purpose='email_recovery' AND status='verified' AND recovery_hash=?
			AND recovery_expires_at > datetime('now') AND user_id=? LIMIT 1`, want, userID).Scan(&ok)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apiErr(403, "恢复凭据已失效，请重新验证恢复方式", "PASSWORD_RECOVERY_INVALID")
		}
		if err != nil {
			return nil, err
		}
		_, _ = s.DB.Exec(`UPDATE email_auth_challenges SET status='consumed' WHERE recovery_hash=?`, want)
	} else {
		s.ensureSMSTables()
		want := hashRecoveryToken("sms:" + parts[1])
		var ok int
		err := s.DB.QueryRow(`SELECT 1 FROM sms_auth_challenges
			WHERE purpose='password_recovery' AND status='verified' AND recovery_hash=?
			AND recovery_expires_at > datetime('now') AND user_id=? LIMIT 1`, want, userID).Scan(&ok)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apiErr(403, "恢复凭据已失效，请重新验证恢复方式", "PASSWORD_RECOVERY_INVALID")
		}
		if err != nil {
			return nil, err
		}
		_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='consumed' WHERE recovery_hash=?`, want)
	}
	res, err := s.DB.Exec(`UPDATE users SET password_hash=?, must_change_password=0, session_version=session_version+1 WHERE id=?`,
		string(newHash), userID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, apiErr(403, "恢复凭据已失效，请重新验证恢复方式", "PASSWORD_RECOVERY_INVALID")
	}
	return map[string]any{"success": true, "message": "密码已重设，请使用新密码重新登录"}, nil
}

func (s *Service) SetPassword(userID int, newPassword string) (map[string]any, error) {
	if !validPassword(newPassword) {
		return nil, apiErr(400, "密码需至少 8 位且包含字母与数字", "INVALID_PASSWORD")
	}
	var hash sql.NullString
	if err := s.DB.QueryRow(`SELECT password_hash FROM users WHERE id=?`, userID).Scan(&hash); err != nil {
		return nil, apiErr(404, "用户不存在", "USER_NOT_FOUND")
	}
	if hash.Valid && hash.String != "" {
		return nil, apiErr(409, "账号已设置密码，请使用修改密码", "PASSWORD_ALREADY_SET")
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return nil, err
	}
	_, err = s.DB.Exec(`UPDATE users SET password_hash=?, must_change_password=0, session_version=session_version+1 WHERE id=?`, string(newHash), userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"success": true, "message": "密码设置成功"}, nil
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
	if err := s.DB.QueryRow(`SELECT password_hash FROM users WHERE id=?`, userID).Scan(&hash); err != nil {
		return nil, apiErr(404, "用户不存在", "USER_NOT_FOUND")
	}
	if !hash.Valid || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(password)) != nil {
		return nil, apiErr(403, "密码不正确", "INVALID_PASSWORD")
	}
	_, err := s.DB.Exec(`DELETE FROM users WHERE id=?`, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true}, nil
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
