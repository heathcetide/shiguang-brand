// Copyright (c) 2026 heathcetide. All rights reserved.

package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/notification/sms"
	"golang.org/x/crypto/bcrypt"
)

type smsPurpose string

const (
	smsPurposeLogin            smsPurpose = "login"
	smsPurposePasswordRecovery smsPurpose = "password_recovery"
	smsPurposePhoneBind        smsPurpose = "phone_bind"
	smsPurposePhoneReplace     smsPurpose = "phone_replace"
	smsPurposePasswordUpdate   smsPurpose = "password_update"
	smsPurposeAccountDelete    smsPurpose = "account_delete"
)

type reauthUser struct {
	ID              int
	Phone           string
	SessionVersion  int
	PhoneVerified   bool
	HasPassword     bool
	Email           sql.NullString
	PhoneCol        sql.NullString
	Role            string
	IsDisabled      bool
	PasswordHash    sql.NullString
}

func (s *Service) ensureSMSTables() {
	_, _ = s.DB.Exec(`CREATE TABLE IF NOT EXISTS sms_auth_challenges (
		id TEXT PRIMARY KEY,
		phone TEXT NOT NULL,
		purpose TEXT NOT NULL,
		code_hash TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		attempts INTEGER NOT NULL DEFAULT 0,
		user_id INTEGER,
		session_version INTEGER,
		target_phone TEXT,
		recovery_hash TEXT,
		recovery_expires_at TEXT,
		registration_token_hash TEXT,
		registration_expires_at TEXT,
		expires_at TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	_, _ = s.DB.Exec(`CREATE TABLE IF NOT EXISTS sms_dev_outbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		phone TEXT,
		purpose TEXT,
		code TEXT,
		challenge_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	_, _ = s.DB.Exec(`CREATE TABLE IF NOT EXISTS account_reauth_grants (
		token_hash TEXT PRIMARY KEY,
		user_id INTEGER,
		purpose TEXT,
		phone TEXT,
		session_version INTEGER,
		expires_at TEXT,
		consumed_at TEXT
	)`)
}

func (s *Service) SMSSend(phone string, purpose smsPurpose, bound *reauthUser) (map[string]any, error) {
	s.ensureSMSTables()
	phone = normalizePhone(phone)
	if phone == "" {
		return nil, apiErr(400, "请输入有效的中国大陆手机号", "INVALID_PHONE")
	}
	var uid any
	var sv any
	var targetPhone string
	if bound != nil {
		uid = bound.ID
		sv = bound.SessionVersion
		if purpose == smsPurposePhoneBind || purpose == smsPurposePhoneReplace {
			targetPhone = normalizePhone(bound.Phone)
			if targetPhone == "" {
				targetPhone = phone
			}
			phone = targetPhone
		} else if bound.Phone != "" {
			phone = bound.Phone
		}
	}

	id := newUUID()
	code := fmt.Sprintf("%06d", secureInt(1000000))
	codeHash := s.smsCodeHash(id, string(purpose), code)
	expires := time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339Nano)
	_, err := s.DB.Exec(`INSERT INTO sms_auth_challenges
		(id, phone, purpose, code_hash, status, user_id, session_version, target_phone, expires_at)
		VALUES (?,?,?,?,'sent',?,?,?,?)`,
		id, phone, string(purpose), codeHash, uid, sv, nullEmpty(targetPhone), expires)
	if err != nil {
		return nil, err
	}
	_, _ = s.DB.Exec(`INSERT INTO sms_dev_outbox (phone, purpose, code, challenge_id) VALUES (?,?,?,?)`,
		phone, string(purpose), code, id)
	fmt.Fprintf(os.Stderr, "[sms-dev] phone=%s purpose=%s challenge=%s code=%s\n", phone, purpose, id, code)
	s.tryAliyunSMS(phone, code)

	return map[string]any{
		"challengeId": id,
		"phoneMasked": maskPhone(phone),
		"resendAfter": 60,
		"expiresIn":   300,
	}, nil
}

func (s *Service) SMSVerify(challengeID, code string, purpose smsPurpose, bound *reauthUser) (map[string]any, error) {
	s.ensureSMSTables()
	if challengeID == "" || !sixDigitCode(code) {
		return nil, apiErr(400, "请输入 6 位数字验证码", "INVALID_VERIFICATION_INPUT")
	}
	codeHash := s.smsCodeHash(challengeID, string(purpose), code)

	var (
		phone, storedHash, status string
		attempts                    int
		chUserID                    sql.NullInt64
		chSession                   sql.NullInt64
		targetPhone                 sql.NullString
		expiresAt                   string
		chPurpose                   string
	)
	err := s.DB.QueryRow(`SELECT phone, code_hash, status, attempts, user_id, session_version, target_phone, expires_at, purpose
		FROM sms_auth_challenges WHERE id=?`, challengeID).Scan(
		&phone, &storedHash, &status, &attempts, &chUserID, &chSession, &targetPhone, &expiresAt, &chPurpose)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apiErr(404, "验证码请求不存在", "SMS_CHALLENGE_NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	if chPurpose != string(purpose) {
		return nil, apiErr(403, "验证码用途不匹配，请重新获取", "SMS_CHALLENGE_PURPOSE_MISMATCH")
	}
	if attempts >= 5 {
		return nil, apiErr(429, "验证码尝试次数过多，请重新获取", "SMS_VERIFY_LIMITED")
	}
	if status != "sent" && status != "verified" {
		return nil, apiErr(409, "该验证码已失效，请重新获取", "SMS_CHALLENGE_NOT_ACTIVE")
	}
	if t, parseErr := time.Parse(time.RFC3339Nano, expiresAt); parseErr == nil && time.Now().After(t) {
		return nil, apiErr(410, "验证码已过期，请重新获取", "SMS_CODE_EXPIRED")
	}
	if purpose != smsPurposeLogin && purpose != smsPurposePasswordRecovery {
		if bound == nil || !chUserID.Valid || int(chUserID.Int64) != bound.ID ||
			int(chSession.Int64) != bound.SessionVersion {
			return nil, apiErr(403, "身份验证已失效，请重新获取", "REAUTH_REQUIRED")
		}
	}
	_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET attempts=attempts+1 WHERE id=?`, challengeID)
	if storedHash != codeHash {
		return nil, apiErr(400, "验证码错误或已失效", "SMS_CODE_INVALID")
	}

	switch purpose {
	case smsPurposePhoneBind:
		newP := targetPhone.String
		if newP == "" {
			newP = phone
		}
		return s.smsVerifyPhoneBind(challengeID, bound, newP)
	case smsPurposePhoneReplace:
		newP := targetPhone.String
		if newP == "" {
			newP = phone
		}
		return s.smsVerifyPhoneReplace(challengeID, bound, newP)
	case smsPurposePasswordRecovery:
		return s.smsVerifyPasswordRecovery(challengeID, bound)
	case smsPurposePasswordUpdate, smsPurposeAccountDelete:
		return s.smsVerifyReauth(challengeID, bound, string(purpose))
	default:
		return s.smsVerifyLogin(challengeID, phone)
	}
}

func (s *Service) smsVerifyLogin(challengeID, phone string) (map[string]any, error) {
	var userID int
	var username string
	var disabled sql.NullInt64
	var sessionVersion sql.NullInt64
	var passwordHash sql.NullString
	err := s.DB.QueryRow(`SELECT id, username, COALESCE(is_disabled,0), session_version, password_hash
		FROM users WHERE phone=?`, phone).Scan(&userID, &username, &disabled, &sessionVersion, &passwordHash)
	if err == nil && disabled.Int64 == 0 {
		sv := int(sessionVersion.Int64)
		if sv < 1 {
			sv = 1
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_, _ = s.DB.Exec(`UPDATE users SET phone_verified_at=COALESCE(phone_verified_at, ?), last_login_at=? WHERE id=?`,
			now, now, userID)
		_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='consumed' WHERE id=?`, challengeID)
		_ = s.ensureInitialStateTxFromDB(userID)
		_ = s.recordFunnel(userID, "login_succeeded")
		token, tokErr := s.Auth.Sign(userID, sv)
		if tokErr != nil {
			return nil, tokErr
		}
		user, _ := s.Me(userID)
		return map[string]any{
			"verified": true,
			"status":   "authenticated",
			"token":    token,
			"user":     user,
			"isNewUser": false,
		}, nil
	}
	regSecret := randomToken(32)
	regHash := hashRegistrationToken(regSecret)
	regExpires := time.Now().UTC().Add(10 * time.Minute).Format(time.RFC3339Nano)
	_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='verified',
		registration_token_hash=?, registration_expires_at=? WHERE id=?`, regHash, regExpires, challengeID)
	return map[string]any{
		"verified":          true,
		"status":            "registration_required",
		"registrationToken": regSecret,
		"phoneMasked":       maskPhone(phone),
		"expiresIn":         600,
	}, nil
}

func (s *Service) SMSRegister(registrationToken, username, password string) (map[string]any, error) {
	s.ensureSMSTables()
	registrationToken = strings.TrimSpace(registrationToken)
	username = strings.TrimSpace(username)
	if len(registrationToken) < 32 {
		return nil, apiErr(400, "注册凭证无效", "INVALID_REGISTRATION_TOKEN")
	}
	if len(username) < 2 || len(username) > 30 {
		return nil, apiErr(400, "用户名长度应为 2 至 30 位", "INVALID_USERNAME")
	}
	if !validPassword(password) {
		return nil, apiErr(400, "密码需至少 8 位且包含字母与数字", "INVALID_PASSWORD")
	}
	want := hashRegistrationToken(registrationToken)
	var challengeID, phone string
	err := s.DB.QueryRow(`SELECT id, phone FROM sms_auth_challenges
		WHERE purpose='login' AND status='verified' AND registration_token_hash=?
		AND registration_expires_at > datetime('now')`, want).Scan(&challengeID, &phone)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apiErr(401, "注册凭证已失效，请重新验证手机号", "REGISTRATION_TOKEN_INVALID")
	}
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM users WHERE phone=? LIMIT 1`, phone).Scan(&exists); err == nil {
		return nil, apiErr(409, "该手机号已注册，请直接登录", "PHONE_EXISTS")
	}
	if err := tx.QueryRow(`SELECT 1 FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1`, username).Scan(&exists); err == nil {
		return nil, apiErr(409, "该用户名已被使用", "USERNAME_EXISTS")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := tx.Exec(`INSERT INTO users (username, phone, password_hash, phone_verified_at, session_version)
		VALUES (?, ?, ?, ?, 1)`, username, phone, string(hash), now)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "users.phone") {
			return nil, apiErr(409, "该手机号已注册，请直接登录", "PHONE_EXISTS")
		}
		if strings.Contains(msg, "users.username") {
			return nil, apiErr(409, "该用户名已被使用", "USERNAME_EXISTS")
		}
		return nil, err
	}
	userID64, _ := res.LastInsertId()
	userID := int(userID64)
	_ = s.ensureInitialStateTx(tx, userID)
	_, _ = tx.Exec(`UPDATE sms_auth_challenges SET status='consumed' WHERE id=?`, challengeID)
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = s.recordFunnel(userID, "account_registered")
	token, err := s.Auth.Sign(userID, 1)
	if err != nil {
		return nil, err
	}
	user, _ := s.Me(userID)
	return map[string]any{"token": token, "user": user}, nil
}

func (s *Service) PasswordRecoverySMSSend(phone string) (map[string]any, error) {
	if strings.Contains(phone, "@") {
		return nil, apiErr(400, "当前暂不支持邮箱自助找回，请使用已绑定的手机号或联系管理员人工恢复", "EMAIL_RECOVERY_UNSUPPORTED")
	}
	phone = normalizePhone(phone)
	if phone == "" {
		return nil, apiErr(400, "请输入已绑定的中国大陆手机号", "INVALID_PHONE")
	}
	var bound *reauthUser
	if u, err := s.userByPhone(phone); err == nil && u != nil && u.PhoneVerified && !u.IsDisabled {
		bound = u
	}
	return s.SMSSend(phone, smsPurposePasswordRecovery, bound)
}

func (s *Service) PasswordRecoverySMSVerify(challengeID, code string) (map[string]any, error) {
	var chUserID sql.NullInt64
	err := s.DB.QueryRow(`SELECT user_id FROM sms_auth_challenges WHERE id=? AND purpose='password_recovery'`,
		challengeID).Scan(&chUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apiErr(404, "验证码请求不存在", "SMS_CHALLENGE_NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	var bound *reauthUser
	if chUserID.Valid {
		bound, _ = s.loadReauthUser(int(chUserID.Int64))
	}
	return s.SMSVerify(challengeID, code, smsPurposePasswordRecovery, bound)
}

func (s *Service) smsVerifyPasswordRecovery(challengeID string, bound *reauthUser) (map[string]any, error) {
	if bound == nil || !bound.PhoneVerified || bound.IsDisabled {
		_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='failed' WHERE id=?`, challengeID)
		return nil, apiErr(400, "无法完成恢复，请重新验证或联系邀请你的管理员", "PASSWORD_RECOVERY_INVALID")
	}
	secret := randomToken(32)
	recoveryHash := hashRecoveryToken("sms:" + secret)
	recoveryExpires := time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339Nano)
	_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='verified', recovery_hash=?, recovery_expires_at=? WHERE id=?`,
		recoveryHash, recoveryExpires, challengeID)
	token := fmt.Sprintf("%d.%s", bound.ID, secret)
	return map[string]any{"verified": true, "recoveryToken": token, "expiresIn": 300}, nil
}

func (s *Service) PhoneBindingSend(userID int, phone, currentPassword string) (map[string]any, error) {
	user, err := s.phoneBindingUser(userID)
	if err != nil {
		return nil, err
	}
	if user.PhoneCol.Valid && user.PhoneCol.String != "" {
		return nil, apiErr(403, "此账号不支持首次绑定手机号", "PHONE_BINDING_INELIGIBLE")
	}
	if !user.Email.Valid || !user.HasPassword || user.Role != "user" || user.IsDisabled {
		return nil, apiErr(403, "此账号不支持首次绑定手机号", "PHONE_BINDING_INELIGIBLE")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(currentPassword)) != nil {
		return nil, apiErr(403, "当前密码不正确", "INVALID_PASSWORD")
	}
	phone = normalizePhone(phone)
	if phone == "" {
		return nil, apiErr(400, "请输入当前密码和有效的中国大陆手机号", "INVALID_PHONE_BINDING_INPUT")
	}
	if existing, _ := s.userByPhone(phone); existing != nil {
		return nil, apiErr(409, "该手机号已被使用", "PHONE_EXISTS")
	}
	bound := *user
	bound.Phone = phone
	return s.SMSSend(phone, smsPurposePhoneBind, &bound)
}

func (s *Service) PhoneBindingVerify(userID int, challengeID, code string) (map[string]any, error) {
	user, err := s.phoneBindingUser(userID)
	if err != nil {
		return nil, err
	}
	return s.SMSVerify(challengeID, code, smsPurposePhoneBind, user)
}

func (s *Service) PhoneReplaceSend(userID int, newPhone, currentPassword string) (map[string]any, error) {
	user, err := s.phoneBindingUser(userID)
	if err != nil {
		return nil, err
	}
	if !user.PhoneVerified || !user.HasPassword || user.Role != "user" || user.IsDisabled {
		return nil, apiErr(403, "此账号不支持更换绑定手机号", "PHONE_REPLACEMENT_INELIGIBLE")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(currentPassword)) != nil {
		return nil, apiErr(403, "当前密码不正确", "INVALID_PASSWORD")
	}
	newPhone = normalizePhone(newPhone)
	if newPhone == "" {
		return nil, apiErr(400, "请输入当前密码和有效的中国大陆新手机号", "INVALID_PHONE_REPLACEMENT_INPUT")
	}
	if user.PhoneCol.Valid && user.PhoneCol.String == newPhone {
		return nil, apiErr(400, "新手机号不能与当前绑定的手机号相同", "PHONE_UNCHANGED")
	}
	if existing, _ := s.userByPhone(newPhone); existing != nil {
		return nil, apiErr(409, "该手机号已被使用", "PHONE_EXISTS")
	}
	bound := *user
	bound.Phone = newPhone
	return s.SMSSend(newPhone, smsPurposePhoneReplace, &bound)
}

func (s *Service) PhoneReplaceVerify(userID int, challengeID, code string) (map[string]any, error) {
	user, err := s.phoneBindingUser(userID)
	if err != nil {
		return nil, err
	}
	return s.SMSVerify(challengeID, code, smsPurposePhoneReplace, user)
}

func (s *Service) ReauthSMSSend(userID int, purpose string) (map[string]any, error) {
	if purpose != "password_update" && purpose != "account_delete" {
		return nil, apiErr(400, "请选择有效的验证用途", "INVALID_REAUTH_PURPOSE")
	}
	user, err := s.loadReauthUser(userID)
	if err != nil || user == nil || !user.PhoneVerified || user.IsDisabled {
		return nil, apiErr(403, "此账号没有可用的已验证手机号", "VERIFIED_PHONE_REQUIRED")
	}
	if purpose == "account_delete" && user.Role == "admin" {
		return nil, apiErr(403, "管理员账号不能通过客户端注销", "ADMIN_ACCOUNT_DELETE_FORBIDDEN")
	}
	p := smsPurposePasswordUpdate
	if purpose == "account_delete" {
		p = smsPurposeAccountDelete
	}
	return s.SMSSend(user.Phone, p, user)
}

func (s *Service) ReauthSMSVerify(userID int, purpose, challengeID, code string) (map[string]any, error) {
	if purpose != "password_update" && purpose != "account_delete" {
		return nil, apiErr(400, "请输入有效的验证码", "INVALID_VERIFICATION_INPUT")
	}
	user, err := s.loadReauthUser(userID)
	if err != nil || user == nil || !user.PhoneVerified || user.IsDisabled {
		return nil, apiErr(403, "此账号没有可用的已验证手机号", "VERIFIED_PHONE_REQUIRED")
	}
	p := smsPurposePasswordUpdate
	if purpose == "account_delete" {
		p = smsPurposeAccountDelete
	}
	return s.SMSVerify(challengeID, code, p, user)
}

func (s *Service) smsVerifyPhoneBind(challengeID string, bound *reauthUser, newPhone string) (map[string]any, error) {
	if bound == nil {
		return nil, apiErr(403, "绑定验证已失效", "PHONE_BINDING_INVALID")
	}
	newPhone = normalizePhone(newPhone)
	if newPhone == "" {
		return nil, apiErr(403, "绑定验证已失效", "PHONE_BINDING_INVALID")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := s.DB.Exec(`UPDATE users SET phone=?, phone_verified_at=?, session_version=session_version+1
		WHERE id=? AND (phone IS NULL OR phone='')`, newPhone, now, bound.ID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, apiErr(403, "绑定已失效或手机号已被占用，请重新验证", "PHONE_BINDING_INVALID")
	}
	_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='consumed' WHERE id=?`, challengeID)
	return map[string]any{"success": true, "verified": true, "phoneMasked": maskPhone(newPhone)}, nil
}

func (s *Service) smsVerifyPhoneReplace(challengeID string, bound *reauthUser, newPhone string) (map[string]any, error) {
	if bound == nil {
		return nil, apiErr(403, "换绑验证已失效", "PHONE_REPLACEMENT_INVALID")
	}
	newPhone = normalizePhone(newPhone)
	if newPhone == "" {
		return nil, apiErr(403, "换绑验证已失效", "PHONE_REPLACEMENT_INVALID")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := s.DB.Exec(`UPDATE users SET phone=?, phone_verified_at=?, session_version=session_version+1
		WHERE id=? AND phone IS NOT NULL AND phone != ''`, newPhone, now, bound.ID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, apiErr(403, "换绑已失效或手机号已被占用，请重新验证", "PHONE_REPLACEMENT_INVALID")
	}
	_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='consumed' WHERE id=?`, challengeID)
	return map[string]any{"success": true, "verified": true, "phoneMasked": maskPhone(newPhone)}, nil
}

func (s *Service) smsVerifyReauth(challengeID string, bound *reauthUser, purpose string) (map[string]any, error) {
	if bound == nil {
		return nil, apiErr(403, "身份验证已失效，请重新获取", "REAUTH_REQUIRED")
	}
	reauthToken := randomToken(32)
	tokenHash := hashRegistrationToken(reauthToken)
	expires := time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339Nano)
	_, err := s.DB.Exec(`INSERT INTO account_reauth_grants (token_hash, user_id, purpose, phone, session_version, expires_at)
		VALUES (?,?,?,?,?,?)`, tokenHash, bound.ID, purpose, bound.Phone, bound.SessionVersion, expires)
	if err != nil {
		return nil, err
	}
	_, _ = s.DB.Exec(`UPDATE sms_auth_challenges SET status='consumed' WHERE id=?`, challengeID)
	return map[string]any{"verified": true, "reauthToken": reauthToken, "expiresIn": 300}, nil
}

func (s *Service) loadReauthUser(userID int) (*reauthUser, error) {
	u := &reauthUser{ID: userID}
	var phoneVerified sql.NullString
	var disabled sql.NullInt64
	err := s.DB.QueryRow(`SELECT phone, phone_verified_at, session_version, password_hash, email, role, COALESCE(is_disabled,0)
		FROM users WHERE id=?`, userID).Scan(&u.PhoneCol, &phoneVerified, &u.SessionVersion, &u.PasswordHash, &u.Email, &u.Role, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apiErr(404, "用户不存在", "USER_NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	if u.PhoneCol.Valid {
		u.Phone = u.PhoneCol.String
	}
	u.PhoneVerified = phoneVerified.Valid && phoneVerified.String != ""
	u.IsDisabled = disabled.Valid && disabled.Int64 != 0
	u.HasPassword = u.PasswordHash.Valid && u.PasswordHash.String != ""
	if u.SessionVersion < 1 {
		u.SessionVersion = 1
	}
	return u, nil
}

func (s *Service) phoneBindingUser(userID int) (*reauthUser, error) {
	return s.loadReauthUser(userID)
}

func (s *Service) userByPhone(phone string) (*reauthUser, error) {
	phone = normalizePhone(phone)
	var id int
	err := s.DB.QueryRow(`SELECT id FROM users WHERE phone=?`, phone).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.loadReauthUser(id)
}

func (s *Service) ensureInitialStateTxFromDB(userID int) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.ensureInitialStateTx(tx, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) smsCodeHash(id, purpose, code string) string {
	mac := hmac.New(sha256.New, s.Auth.Secret)
	_, _ = mac.Write([]byte("sms-code:" + id + ":" + purpose + ":" + code))
	return hex.EncodeToString(mac.Sum(nil))
}

func hashRegistrationToken(value string) string {
	sum := sha256.Sum256([]byte("registration:" + value))
	return hex.EncodeToString(sum[:])
}

func normalizePhone(v string) string {
	v = strings.TrimSpace(v)
	if phonePattern.MatchString(v) {
		return v
	}
	return ""
}

func maskPhone(phone string) string {
	if len(phone) != 11 {
		return phone
	}
	return phone[:3] + "****" + phone[7:]
}

func sixDigitCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func nullEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// tryAliyunSMS sends via Aliyun when ALIYUN_SMS_* credentials are set; dev outbox remains the local fallback.
func (s *Service) tryAliyunSMS(phone, code string) {
	enabled := strings.TrimSpace(os.Getenv("ALIYUN_SMS_ENABLED"))
	if enabled != "1" && !strings.EqualFold(enabled, "true") {
		return
	}
	accessKey := strings.TrimSpace(os.Getenv("ALIYUN_SMS_ACCESS_KEY_ID"))
	if accessKey == "" {
		accessKey = strings.TrimSpace(os.Getenv("ALIYUN_ACCESS_KEY_ID"))
	}
	secret := strings.TrimSpace(os.Getenv("ALIYUN_SMS_ACCESS_KEY_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("ALIYUN_ACCESS_KEY_SECRET"))
	}
	signName := strings.TrimSpace(os.Getenv("ALIYUN_SMS_SIGN_NAME"))
	template := strings.TrimSpace(os.Getenv("ALIYUN_SMS_TEMPLATE_CODE"))
	if accessKey == "" || secret == "" || signName == "" || template == "" {
		fmt.Fprintf(os.Stderr, "[sms] ALIYUN_SMS_* incomplete; keeping dev outbox only (see server-go auth sms)\n")
		return
	}
	provider, err := sms.NewAliyunProvider(sms.ProviderConfig{
		"access_key_id":     accessKey,
		"access_key_secret": secret,
		"sign_name":         signName,
		"content_template":  template,
		"content_param_key": "code",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "[sms] aliyun provider init failed: %v\n", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	_, err = provider.Send(ctx, sms.SendRequest{
		To: []sms.PhoneNumber{{Number: phone, CountryCode: 86}},
		Message: sms.Message{
			Template: template,
			Data:     map[string]string{pickedSMSCodeParamKey(): code},
			SignName: signName,
		},
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "[sms] aliyun send failed (dev outbox still valid): %v\n", err)
	}
}

func pickedSMSCodeParamKey() string {
	if k := strings.TrimSpace(os.Getenv("ALIYUN_SMS_CONTENT_PARAM_KEY")); k != "" {
		return k
	}
	return "code"
}
