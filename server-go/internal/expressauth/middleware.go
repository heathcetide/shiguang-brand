// Copyright (c) 2026 heathcetide. All rights reserved.

package expressauth

import (
	"database/sql"
	"errors"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

const ContextUserID = "express_user_id"

// Claims matches Express SessionTokenClaims.
type Claims struct {
	UserID         int `json:"userId"`
	SessionVersion int `json:"sessionVersion"`
	jwt.RegisteredClaims
}

// Auth holds JWT secret and DB for session checks.
type Auth struct {
	Secret []byte
	DB     *dbx.DB
}

func New(secret string, database *dbx.DB) *Auth {
	return &Auth{Secret: []byte(secret), DB: database}
}

// Middleware requires a valid Express Bearer token.
func (a *Auth) Middleware() gin.HandlerFunc {
	return a.middleware(true)
}

// OptionalMiddleware accepts missing auth but rejects invalid tokens.
func (a *Auth) OptionalMiddleware() gin.HandlerFunc {
	return a.middleware(false)
}

func (a *Auth) middleware(required bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			if required {
				httpx.AbortAuth(c)
				return
			}
			c.Next()
			return
		}
		if !strings.HasPrefix(header, "Bearer ") {
			httpx.SendError(c, http.StatusUnauthorized, "无效的认证格式", "INVALID_AUTH_HEADER")
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		claims, err := a.Parse(token)
		if err != nil {
			if errors.Is(err, jwt.ErrTokenExpired) {
				httpx.SendError(c, http.StatusUnauthorized, "Token 已过期，请重新登录", "TOKEN_EXPIRED")
				return
			}
			httpx.SendError(c, http.StatusUnauthorized, "无效的 Token", "INVALID_TOKEN")
			return
		}
		user, err := a.loadUser(claims.UserID)
		if err != nil || user == nil {
			httpx.SendError(c, http.StatusUnauthorized, "用户不存在", "USER_NOT_FOUND")
			return
		}
		if user.IsDisabled {
			httpx.SendError(c, http.StatusForbidden, "账号已被停用", "ACCOUNT_DISABLED")
			return
		}
		if claims.SessionVersion != user.SessionVersion {
			httpx.SendError(c, http.StatusUnauthorized, "登录会话已失效，请重新登录", "SESSION_REVOKED")
			return
		}
		c.Set(ContextUserID, claims.UserID)
		c.Next()
	}
}

// Parse verifies an Express JWT.
func (a *Auth) Parse(token string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return a.Secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}
	if claims.UserID <= 0 {
		return nil, jwt.ErrTokenInvalidClaims
	}
	if claims.SessionVersion < 1 {
		claims.SessionVersion = 1
	}
	return claims, nil
}

// Sign creates an Express-compatible access token (30d).
func (a *Auth) Sign(userID, sessionVersion int) (string, error) {
	if sessionVersion < 1 {
		sessionVersion = 1
	}
	claims := Claims{
		UserID:         userID,
		SessionVersion: sessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(jwtExpiry()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.Secret)
}

type accessUser struct {
	SessionVersion int
	IsDisabled     bool
}

func (a *Auth) loadUser(userID int) (*accessUser, error) {
	var sessionVersion sql.NullInt64
	var isDisabled sql.NullInt64
	err := a.DB.QueryRow(`SELECT session_version, COALESCE(is_disabled, 0) FROM users WHERE id = ?`, userID).
		Scan(&sessionVersion, &isDisabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sv := int(sessionVersion.Int64)
	if sv < 1 {
		sv = 1
	}
	return &accessUser{SessionVersion: sv, IsDisabled: isDisabled.Int64 == 1}, nil
}

// UserID extracts authenticated user id from context.
func UserID(c *gin.Context) (int, bool) {
	v, ok := c.Get(ContextUserID)
	if !ok {
		return 0, false
	}
	id, ok := v.(int)
	return id, ok && id > 0
}
