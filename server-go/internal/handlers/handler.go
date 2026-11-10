// Copyright (c) 2026 heathcetide. All rights reserved.

package handlers

import (
	"errors"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/constants"
	"github.com/heathcetide/DietDigiDose/internal/models"
	"github.com/heathcetide/DietDigiDose/internal/types"

	"github.com/heathcetide/DietDigiDose/pkg/common"
	"github.com/heathcetide/DietDigiDose/pkg/common/password"
	"github.com/heathcetide/DietDigiDose/pkg/common/response"
	respgin "github.com/heathcetide/DietDigiDose/pkg/common/response/gin"
	"github.com/heathcetide/DietDigiDose/pkg/common/validate"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// System endpoints

// Health returns the overall health status.
func (h *Handlers) Health(c *gin.Context) {
	respgin.Success(c, gin.H{
		"status":  "healthy",
		"uptime":  time.Since(h.startTime).String(),
		"env":     h.cfg.App.Environment,
		"version": h.info.Version,
	})
}

// Liveness is the Kubernetes liveness probe endpoint.
func (h *Handlers) Liveness(c *gin.Context) {
	respgin.Success(c, gin.H{"status": "alive"})
}

// Readiness is the Kubernetes readiness probe endpoint.
func (h *Handlers) Readiness(c *gin.Context) {
	respgin.Success(c, gin.H{"status": "ready"})
}

// Version returns build and version metadata.
func (h *Handlers) Version(c *gin.Context) {
	respgin.Success(c, gin.H{
		"name":      h.info.Name,
		"version":   h.info.Version,
		"buildTime": h.info.BuildTime,
		"gitCommit": h.info.GitCommit,
	})
}

// User CRUD + registration + password management

// ListUsers returns a paginated, filterable list of users.
func (h *Handlers) ListUsers(c *gin.Context) {
	var req types.UserListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}
	page, size := req.Normalize()

	if h.db == nil {
		users := []types.UserResponse{
			{ID: 1, Username: "alice", Email: "alice@example.com", Role: "user", Status: 1, CreatedAt: time.Now()},
			{ID: 2, Username: "bob", Email: "bob@example.com", Role: "user", Status: 1, CreatedAt: time.Now()},
		}
		respgin.Success(c, response.NewPage(users, int64(len(users)), page, size))
		return
	}

	f := models.ListFilter{
		Keyword: req.Keyword,
		Status:  req.Status,
		Role:    req.Role,
	}
	users, total, err := models.User{}.List(h.db.WithContext(c.Request.Context()), page, size, f)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	result := make([]types.UserResponse, len(users))
	for i := range users {
		result[i] = types.ToUserResponse(&users[i])
	}
	respgin.Success(c, response.NewPage(result, total, page, size))
}

// GetUser returns a single user by ID.
func (h *Handlers) GetUser(c *gin.Context) {
	var req types.IDRequest
	if err := c.ShouldBindUri(&req); err != nil {
		respgin.WriteError(c, response.Err(response.CodeBadRequest))
		return
	}

	if h.db == nil {
		respgin.WriteError(c, response.Err(response.CodeNotFound))
		return
	}

	user, err := models.User{}.FindByID(h.db.WithContext(c.Request.Context()), req.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			respgin.WriteError(c, response.Err(response.CodeNotFound))
			return
		}
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	respgin.Success(c, types.ToUserResponse(user))
}

// RegisterUser creates a new user account (public registration endpoint).
// Supports both username and email based registration.
// If username is not provided, it defaults to the email prefix.
func (h *Handlers) RegisterUser(c *gin.Context) {
	var req types.RegisterRequest
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

	// If username not provided, derive from email prefix
	username := req.Username
	if username == "" {
		at := indexOf(req.Email, "@")
		if at > 0 {
			username = req.Email[:at]
		} else {
			username = req.Email
		}
	}

	// Check for duplicate username/email
	exists, err := models.User{}.UsernameOrEmailExists(h.db.WithContext(c.Request.Context()), username, req.Email)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	if exists {
		respgin.WriteError(c, response.New(response.CodeConflict, "username or email already exists"))
		return
	}

	// Hash password using ling-base/common/password (Argon2id by default)
	hashed, err := password.Hash(req.Password, nil)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	user := models.User{
		Username: username,
		Email:    req.Email,
		Phone:    req.Phone,
		Password: hashed,
		Role:     models.UserRoleUser,
		Status:   models.UserStatusActive,
	}

	if err := user.Create(h.db.WithContext(c.Request.Context())); err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	common.Sig().Emit(constants.EventUserRegistered, h, user.ID, user.Username, user.Email)
	respgin.Created(c, types.ToUserResponse(&user))
}

// CreateUser creates a new user (admin endpoint, can set role).
func (h *Handlers) CreateUser(c *gin.Context) {
	var req types.CreateUserRequest
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

	// Check for duplicate
	exists, err := models.User{}.UsernameOrEmailExists(h.db.WithContext(c.Request.Context()), req.Username, req.Email)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	if exists {
		respgin.WriteError(c, response.New(response.CodeConflict, "username or email already exists"))
		return
	}

	// Hash password using ling-base/common/password
	hashed, err := password.Hash(req.Password, nil)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	role := req.Role
	if role == "" {
		role = models.UserRoleUser
	}

	user := models.User{
		Username: req.Username,
		Email:    req.Email,
		Phone:    req.Phone,
		Password: hashed,
		Role:     role,
		Status:   models.UserStatusActive,
	}

	if err := user.Create(h.db.WithContext(c.Request.Context())); err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	common.Sig().Emit(constants.EventUserRegistered, h, user.ID, user.Username, user.Email)
	respgin.Created(c, types.ToUserResponse(&user))
}

// UpdateUser updates a user's profile fields.
func (h *Handlers) UpdateUser(c *gin.Context) {
	var idReq types.IDRequest
	if err := c.ShouldBindUri(&idReq); err != nil {
		respgin.WriteError(c, response.Err(response.CodeBadRequest))
		return
	}

	var req types.UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}
	if err := validate.Validate(&req); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}

	if h.db == nil {
		respgin.WriteError(c, response.Err(response.CodeNotFound))
		return
	}

	user, err := models.User{}.FindByID(h.db.WithContext(c.Request.Context()), idReq.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			respgin.WriteError(c, response.Err(response.CodeNotFound))
			return
		}
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	// Apply partial updates
	updates := map[string]interface{}{}
	if req.Username != nil {
		updates["username"] = *req.Username
	}
	if req.Email != nil {
		updates["email"] = *req.Email
	}
	if req.Phone != nil {
		updates["phone"] = *req.Phone
	}
	if req.Avatar != nil {
		updates["avatar"] = *req.Avatar
	}
	if req.Role != nil {
		updates["role"] = *req.Role
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}

	if len(updates) > 0 {
		if err := user.Updates(h.db.WithContext(c.Request.Context()), updates); err != nil {
			respgin.WriteError(c, response.Err(response.CodeInternal))
			return
		}
	}
	respgin.Success(c, types.ToUserResponse(user))
}

// ChangePassword changes a user's password (requires old password verification).
func (h *Handlers) ChangePassword(c *gin.Context) {
	var idReq types.IDRequest
	if err := c.ShouldBindUri(&idReq); err != nil {
		respgin.WriteError(c, response.Err(response.CodeBadRequest))
		return
	}

	var req types.ChangePasswordRequest
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

	user, err := models.User{}.FindByID(h.db.WithContext(c.Request.Context()), idReq.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			respgin.WriteError(c, response.Err(response.CodeNotFound))
			return
		}
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	// Verify old password using ling-base/common/password
	if !password.Verify(req.OldPassword, user.Password) {
		respgin.WriteError(c, response.New(response.CodeUnauthorized, "incorrect old password"))
		return
	}

	// Hash new password
	hashed, err := password.Hash(req.NewPassword, nil)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}

	if err := (models.User{}).UpdatePassword(h.db.WithContext(c.Request.Context()), user.ID, hashed); err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	common.Sig().Emit(constants.EventUserPasswordChanged, h, user.ID)
	respgin.Success(c, gin.H{"message": "password changed"})
}

// DeleteUser soft-deletes a user by ID.
func (h *Handlers) DeleteUser(c *gin.Context) {
	var req types.IDRequest
	if err := c.ShouldBindUri(&req); err != nil {
		respgin.WriteError(c, response.Err(response.CodeBadRequest))
		return
	}

	if h.db == nil {
		respgin.WriteError(c, response.Err(response.CodeNotFound))
		return
	}

	if err := (models.User{}).DeleteByID(h.db.WithContext(c.Request.Context()), req.ID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			respgin.WriteError(c, response.Err(response.CodeNotFound))
			return
		}
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	common.Sig().Emit(constants.EventUserDeleted, h, req.ID)
	respgin.NoContent(c)
}

// indexOf returns the index of the first occurrence of substr in s, or -1.
func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
