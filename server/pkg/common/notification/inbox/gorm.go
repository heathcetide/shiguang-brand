// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package inbox

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// GormMessage is the gorm-backed persistence model for inbox messages.
// Applications using GormStore should include it in their AutoMigrate
// call: db.AutoMigrate(&inbox.GormMessage{}).
type GormMessage struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UserID      string    `gorm:"index" json:"user_id"`
	Title       string    `json:"title"`
	Content     string    `json:"content"`
	ActionURL   string    `json:"action_url"`
	ActionLabel string    `json:"action_label"`
	Read        bool      `gorm:"index" json:"read"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TableName overrides the default table name.
func (GormMessage) TableName() string { return "inbox_messages" }

// GormStore is a gorm-backed implementation of Store.
type GormStore struct {
	db *gorm.DB
}

// NewGormStore creates a GormStore using the provided gorm.DB.
// The caller is responsible for running migrations, e.g.
//
//	db.AutoMigrate(&inbox.GormMessage{})
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// Create persists a new message. ID and timestamps are assigned by the
// database; the caller-supplied ID field (string) is ignored in favour
// of the auto-increment primary key.
func (s *GormStore) Create(msg Message) error {
	if msg.UserID == "" {
		return fmt.Errorf("inbox: userID is required")
	}
	row := GormMessage{
		UserID:      msg.UserID,
		Title:       msg.Title,
		Content:     msg.Content,
		ActionURL:   msg.ActionURL,
		ActionLabel: msg.ActionLabel,
		Read:        msg.Read,
	}
	if !msg.CreatedAt.IsZero() {
		row.CreatedAt = msg.CreatedAt
	}
	if !msg.UpdatedAt.IsZero() {
		row.UpdatedAt = msg.UpdatedAt
	}
	if err := s.db.Create(&row).Error; err != nil {
		return err
	}
	return nil
}

// GetByID retrieves a single message by userID and ID.
func (s *GormStore) GetByID(userID, id string) (*Message, error) {
	var row GormMessage
	if err := s.db.Where("user_id = ? AND id = ?", userID, id).First(&row).Error; err != nil {
		return nil, err
	}
	return rowToMessage(&row), nil
}

// List returns a paginated, filtered view of a user's messages.
func (s *GormStore) List(userID string, page, size int, filter, titleKeyword, contentKeyword string, startTime, endTime time.Time) (PageResult, error) {
	if !IsValidFilter(filter) {
		filter = FilterAll
	}

	// Unfiltered totals for the user (used for totalUnread/totalRead).
	var totalUnread, totalRead int64
	s.db.Model(&GormMessage{}).Where("user_id = ? AND `read` = ?", userID, false).Count(&totalUnread)
	s.db.Model(&GormMessage{}).Where("user_id = ? AND `read` = ?", userID, true).Count(&totalRead)

	q := s.db.Model(&GormMessage{}).Where("user_id = ?", userID)
	switch filter {
	case FilterUnread:
		q = q.Where("`read` = ?", false)
	case FilterRead:
		q = q.Where("`read` = ?", true)
	}
	if titleKeyword != "" {
		q = q.Where("title LIKE ?", "%"+titleKeyword+"%")
	}
	if contentKeyword != "" {
		q = q.Where("content LIKE ?", "%"+contentKeyword+"%")
	}
	if !startTime.IsZero() && !endTime.IsZero() {
		q = q.Where("created_at BETWEEN ? AND ?", startTime, endTime)
	} else if !startTime.IsZero() {
		q = q.Where("created_at >= ?", startTime)
	} else if !endTime.IsZero() {
		q = q.Where("created_at <= ?", endTime)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return PageResult{}, err
	}

	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 10
	}
	offset := (page - 1) * size

	var rows []GormMessage
	if err := q.Offset(offset).Limit(size).Order("created_at DESC").Find(&rows).Error; err != nil {
		return PageResult{}, err
	}

	list := make([]Message, 0, len(rows))
	for i := range rows {
		list = append(list, *rowToMessage(&rows[i]))
	}

	return PageResult{
		List:        list,
		Total:       total,
		TotalUnread: totalUnread,
		TotalRead:   totalRead,
	}, nil
}

// UnreadCount returns the number of unread messages for the user.
func (s *GormStore) UnreadCount(userID string) (int64, error) {
	var count int64
	if err := s.db.Model(&GormMessage{}).Where("user_id = ? AND `read` = ?", userID, false).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// MarkRead marks a single message as read.
func (s *GormStore) MarkRead(userID, id string) error {
	return s.db.Model(&GormMessage{}).
		Where("user_id = ? AND id = ?", userID, id).
		Update("`read`", true).Error
}

// MarkAllRead marks every unread message for the user as read.
func (s *GormStore) MarkAllRead(userID string) error {
	return s.db.Model(&GormMessage{}).
		Where("user_id = ?", userID).
		Update("`read`", true).Error
}

// Delete removes a single message by ID.
func (s *GormStore) Delete(userID, id string) error {
	return s.db.Where("user_id = ? AND id = ?", userID, id).Delete(&GormMessage{}).Error
}

// BatchDelete removes multiple messages by ID and returns the number
// actually removed.
func (s *GormStore) BatchDelete(userID string, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	// Convert string IDs to uint for the primary key.
	uintIDs := make([]uint, 0, len(ids))
	for _, id := range ids {
		var u uint
		if _, err := fmt.Sscanf(id, "%d", &u); err == nil {
			uintIDs = append(uintIDs, u)
		}
	}
	if len(uintIDs) == 0 {
		return 0, nil
	}
	result := s.db.Where("user_id = ? AND id IN ?", userID, uintIDs).Delete(&GormMessage{})
	return result.RowsAffected, result.Error
}

// CleanOldUnread deletes unread messages older than `before` across all
// users and returns the number removed.
func (s *GormStore) CleanOldUnread(before time.Time) (int64, error) {
	result := s.db.Where("`read` = ? AND created_at < ?", false, before).Delete(&GormMessage{})
	return result.RowsAffected, result.Error
}

// rowToMessage converts a GormMessage row to a Message value.
func rowToMessage(row *GormMessage) *Message {
	return &Message{
		ID:          fmt.Sprintf("%d", row.ID),
		UserID:      row.UserID,
		Title:       row.Title,
		Content:     row.Content,
		ActionURL:   row.ActionURL,
		ActionLabel: row.ActionLabel,
		Read:        row.Read,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}
