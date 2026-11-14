// Copyright (c) 2026 heathcetide. All rights reserved.

package models

import (
	"errors"

	"github.com/heathcetide/DietDigiDose/internal/constants"

	"github.com/heathcetide/DietDigiDose/pkg/common"
	"gorm.io/gorm"
)

// User status constants.
const (
	UserStatusActive   = 1 // active user
	UserStatusDisabled = 0 // disabled user
)

// User role constants.
const (
	UserRoleAdmin = "admin"
	UserRoleUser  = "user"
)

// User represents a registered user account.
// Embeds common.BaseModel for ID (snowflake), timestamps, soft delete, and audit fields.
type User struct {
	common.BaseModel
	Username    string `json:"username" gorm:"size:50;uniqueIndex;not null"`
	Email       string `json:"email" gorm:"size:200;uniqueIndex;not null"`
	Phone       string `json:"phone,omitempty" gorm:"size:20"`
	Password    string `json:"-" gorm:"size:255;not null"` // never serialized to JSON
	Avatar      string `json:"avatar,omitempty" gorm:"size:500"`
	Role        string `json:"role" gorm:"size:20;default:user;not null"`
	Status      int    `json:"status" gorm:"default:1;not null"` // 1=active, 0=disabled
	LastLoginAt *int64 `json:"lastLoginAt,omitempty"`            // unix timestamp
}

func (User) TableName() string { return constants.TableUsers }

// IsActive returns true if the user status is active.
func (u *User) IsActive() bool { return u.Status == UserStatusActive }

// FindByID loads a user by primary key.
func (User) FindByID(db *gorm.DB, id uint) (*User, error) {
	var u User
	if err := db.First(&u, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &u, nil
}

// FindByUsername loads a user by username.
func (User) FindByUsername(db *gorm.DB, username string) (*User, error) {
	var u User
	if err := db.Where("username = ?", username).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &u, nil
}

// FindByEmail loads a user by email.
func (User) FindByEmail(db *gorm.DB, email string) (*User, error) {
	var u User
	if err := db.Where("email = ?", email).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &u, nil
}

// FindByUsernameOrEmail loads a user by username (if non-empty) or email.
func (User) FindByUsernameOrEmail(db *gorm.DB, username, email string) (*User, error) {
	var u User
	q := db
	if username != "" {
		q = q.Where("username = ?", username)
	} else {
		q = q.Where("email = ?", email)
	}
	if err := q.First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &u, nil
}

// UsernameOrEmailExists returns true if a user with the given username or email already exists.
func (User) UsernameOrEmailExists(db *gorm.DB, username, email string) (bool, error) {
	var count int64
	if err := db.Model(&User{}).
		Where("username = ? OR email = ?", username, email).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// ListFilter holds optional filters for paginated user queries.
type ListFilter struct {
	Keyword string
	Status  *int
	Role    string
}

// List returns a paginated, filtered list of users ordered by newest first.
// Returns (users, total, error).
func (User) List(db *gorm.DB, page, size int, f ListFilter) ([]User, int64, error) {
	q := db.Model(&User{})
	if f.Keyword != "" {
		like := "%" + f.Keyword + "%"
		q = q.Where("username LIKE ? OR email LIKE ?", like, like)
	}
	if f.Status != nil {
		q = q.Where("status = ?", *f.Status)
	}
	if f.Role != "" {
		q = q.Where("role = ?", f.Role)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var users []User
	offset := (page - 1) * size
	if err := q.Order("id DESC").Offset(offset).Limit(size).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

// Create persists the user.
func (u *User) Create(db *gorm.DB) error {
	return db.Create(u).Error
}

// Updates applies a partial update map to the user.
func (u *User) Updates(db *gorm.DB, updates map[string]interface{}) error {
	return db.Model(u).Updates(updates).Error
}

// UpdatePassword sets a new hashed password for the user.
func (User) UpdatePassword(db *gorm.DB, id uint, hashedPassword string) error {
	return db.Model(&User{}).Where("id = ?", id).Update("password", hashedPassword).Error
}

// UpdateLastLogin records the unix timestamp of the most recent successful login.
func (User) UpdateLastLogin(db *gorm.DB, id uint, loginAt int64) error {
	return db.Model(&User{}).Where("id = ?", id).Update("last_login_at", loginAt).Error
}

// DeleteByID soft-deletes a user by ID.
// Returns gorm.ErrRecordNotFound if the user does not exist.
func (User) DeleteByID(db *gorm.DB, id uint) error {
	result := db.Delete(&User{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
