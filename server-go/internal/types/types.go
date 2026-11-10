// Copyright (c) 2026 heathcetide. All rights reserved.

// Package types defines shared DTOs (Data Transfer Objects) used across
// handler, service, and repository layers.
//
// Validation tags:
//   - binding: gin/go-playground/validator built-in (triggered on ShouldBind)
//   - validate: ling-base/common/validate (triggered on validate.Validate())
// Both can coexist; when the validate module is enabled, handlers
// additionally call validate.Validate().
package types

import (
	"time"

	"github.com/heathcetide/DietDigiDose/internal/models"
)

// Pagination

// PageRequest is the standard pagination query parameter.
type PageRequest struct {
	Page int `json:"page" form:"page" example:"1" validate:"gte=1"`
	Size int `json:"size" form:"size" example:"20" validate:"gte=1,lte=100"`
}

// Normalize returns sanitized (page, size) with defaults.
func (r *PageRequest) Normalize() (int, int) {
	page := r.Page
	size := r.Size
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	return page, size
}

// ID parameter

// IDRequest extracts an ID from the URL path.
type IDRequest struct {
	ID uint `json:"id" uri:"id" example:"1" validate:"required"`
}

// User DTOs

// RegisterRequest is the request body for user registration.
// Supports both username and email based registration.
type RegisterRequest struct {
	Username string `json:"username" binding:"omitempty,min=3,max=50" validate:"min=3,max=50"`
	Email    string `json:"email" binding:"required,email" validate:"required,email"`
	Password string `json:"password" binding:"required,min=6,max=128" validate:"required,min=6,max=128"`
	Phone    string `json:"phone" binding:"omitempty,max=20" validate:"max=20"`
}

// CreateUserRequest is the request body for creating a user (admin endpoint).
type CreateUserRequest struct {
	Username string `json:"username" binding:"required,min=3,max=50" validate:"required,min=3,max=50"`
	Email    string `json:"email" binding:"required,email" validate:"required,email"`
	Password string `json:"password" binding:"required,min=6,max=128" validate:"required,min=6,max=128"`
	Phone    string `json:"phone" binding:"omitempty,max=20" validate:"max=20"`
	Role     string `json:"role" binding:"omitempty,oneof=admin user"`
}

// UpdateUserRequest is the request body for updating a user.
// All fields are optional (pointer types); nil means "don't update".
type UpdateUserRequest struct {
	Username *string `json:"username" binding:"omitempty,min=3,max=50"`
	Email    *string `json:"email" binding:"omitempty,email"`
	Phone    *string `json:"phone" binding:"omitempty,max=20"`
	Avatar   *string `json:"avatar" binding:"omitempty,max=500"`
	Role     *string `json:"role" binding:"omitempty,oneof=admin user"`
	Status   *int    `json:"status" binding:"omitempty,oneof=0 1"`
}

// ChangePasswordRequest is the request body for changing a user's password.
type ChangePasswordRequest struct {
	OldPassword string `json:"oldPassword" binding:"required,min=6,max=128" validate:"required,min=6,max=128"`
	NewPassword string `json:"newPassword" binding:"required,min=6,max=128" validate:"required,min=6,max=128,nefield=OldPassword"`
}

// UserListRequest extends PageRequest with search/filter parameters.
type UserListRequest struct {
	PageRequest
	Keyword string `json:"keyword" form:"keyword" example:"alice"`
	Status  *int   `json:"status" form:"status" example:"1"`
	Role    string `json:"role" form:"role" example:"admin"`
}

// UserResponse is the public user representation (no password).
type UserResponse struct {
	ID          uint      `json:"id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	Phone       string    `json:"phone,omitempty"`
	Avatar      string    `json:"avatar,omitempty"`
	Role        string    `json:"role"`
	Status      int       `json:"status"`
	LastLoginAt *int64    `json:"lastLoginAt,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ToUserResponse converts a models.User to a UserResponse (strips password).
func ToUserResponse(u *models.User) UserResponse {
	return UserResponse{
		ID:          u.ID,
		Username:    u.Username,
		Email:       u.Email,
		Phone:       u.Phone,
		Avatar:      u.Avatar,
		Role:        u.Role,
		Status:      u.Status,
		LastLoginAt: u.LastLoginAt,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
	}
}

// Auth DTOs

// LoginRequest is the request body for user login.
// Supports both username and email based login.
// If Username is provided, login by username; otherwise login by email.
type LoginRequest struct {
	Username string `json:"username" binding:"omitempty,min=1,max=50"`
	Email    string `json:"email" binding:"omitempty,email"`
	Password string `json:"password" binding:"required" validate:"required,min=6,max=128"`
}

// RefreshRequest is the request body for refreshing a token.
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required" validate:"required"`
}

// TokenResponse is the login/refresh success response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// File storage DTOs

// FileUploadResponse is the response for a successful file upload.
type FileUploadResponse struct {
	Key       string `json:"key" example:"avatars/20260107_120000_photo.jpg"`
	Name      string `json:"name" example:"photo.jpg"`
	Size      int64  `json:"size" example:"102400"`
	PublicURL string `json:"publicUrl" example:"/uploads/avatars/20260107_120000_photo.jpg"`
}
