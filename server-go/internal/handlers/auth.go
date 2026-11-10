// Copyright (c) 2026 heathcetide. All rights reserved.

package handlers

import (
	"errors"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/constants"
	"github.com/heathcetide/DietDigiDose/internal/models"
	"github.com/heathcetide/DietDigiDose/internal/types"

	"github.com/heathcetide/DietDigiDose/pkg/common"
	"github.com/heathcetide/DietDigiDose/pkg/common/jwtutil"
	"github.com/heathcetide/DietDigiDose/pkg/common/password"
	"github.com/heathcetide/DietDigiDose/pkg/common/response"
	respgin "github.com/heathcetide/DietDigiDose/pkg/common/response/gin"
	"github.com/heathcetide/DietDigiDose/pkg/common/validate"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Login authenticates a user and issues JWT access/refresh tokens.
// Supports both username and email based login:
//   - If Username is provided, lookup by username
//   - If Email is provided (and Username is empty), lookup by email
//
// Password is verified using ling-base/common/password (Argon2id/bcrypt).
func (h *Handlers) Login(c *gin.Context) {
	if h.jwtAuth == nil {
		respgin.WriteError(c, response.Err(response.CodeServiceUnavail))
		return
	}

	var req types.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}
	if err := validate.Validate(&req); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}

	if h.db == nil {
		respgin.WriteError(c, response.Err(response.CodeServiceUnavail))
		return
	}

	// Validate that at least one identifier is provided
	if req.Username == "" && req.Email == "" {
		respgin.WriteError(c, response.New(response.CodeBadRequest, "username or email is required"))
		return
	}

	// Find user by username or email
	user, err := models.User{}.FindByUsernameOrEmail(h.db.WithContext(c.Request.Context()), req.Username, req.Email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			respgin.WriteError(c, response.New(response.CodeUnauthorized, "invalid credentials"))
			return
		}
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	// Check account status
	if !user.IsActive() {
		respgin.WriteError(c, response.New(response.CodeForbidden, "account is disabled"))
		return
	}

	// Verify password using ling-base/common/password
	if !password.Verify(req.Password, user.Password) {
		respgin.WriteError(c, response.New(response.CodeUnauthorized, "invalid credentials"))
		return
	}

	// Issue tokens — use username as the subject
	pair, err := h.jwtAuth.Login(user.Username)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	// Update last login time (unix timestamp)
	_ = models.User{}.UpdateLastLogin(h.db.WithContext(c.Request.Context()), user.ID, time.Now().Unix())

	// Emit login event for post-processing (audit log, notifications, etc.)
	common.Sig().Emit(constants.EventUserLogin, h, user.ID, user.Username)

	respgin.Success(c, types.TokenResponse{
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		ExpiresIn:    pair.ExpiresIn,
		TokenType:    pair.TokenType,
	})
}

// Refresh exchanges a refresh token for a new access/refresh token pair.
func (h *Handlers) Refresh(c *gin.Context) {
	if h.jwtAuth == nil {
		respgin.WriteError(c, response.Err(response.CodeServiceUnavail))
		return
	}

	var req types.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}
	if err := validate.Validate(&req); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}

	pair, err := h.jwtAuth.Refresh(req.RefreshToken)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeUnauthorized))
		return
	}
	respgin.Success(c, types.TokenResponse{
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		ExpiresIn:    pair.ExpiresIn,
		TokenType:    pair.TokenType,
	})
}

// ClaimsFromContext extracts JWT claims from the gin.Context
// (must be used after jwtingin.Middleware).
func ClaimsFromContext(c *gin.Context) *jwtutil.Claims {
	if v, ok := c.Get("jwt_claims"); ok {
		if claims, ok := v.(*jwtutil.Claims); ok {
			return claims
		}
	}
	return nil
}
