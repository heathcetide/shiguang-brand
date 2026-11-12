// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

func appTimeZone() *time.Location {
	name := strings.TrimSpace(os.Getenv("APP_TIME_ZONE"))
	if name == "" {
		name = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}

func currentDateKey(t time.Time) string {
	return t.In(appTimeZone()).Format("2006-01-02")
}

func dateKeyAfterDays(today string, days int) string {
	t, err := time.ParseInLocation("2006-01-02", today, appTimeZone())
	if err != nil {
		t = time.Now().In(appTimeZone())
	}
	return t.AddDate(0, 0, days).Format("2006-01-02")
}

func expiryContent(today string, items []expiryItem) (title, body, priority string) {
	first := items[0]
	start, _ := time.Parse("2006-01-02", today)
	exp, _ := time.Parse("2006-01-02", first.Expiration)
	days := int(exp.Sub(start).Hours() / 24)
	if days < 0 {
		days = 0
	}
	priority = "normal"
	title = "3 天内临期提醒"
	switch days {
	case 0:
		priority = "urgent"
		title = "今天到期，请尽快处理"
	case 1:
		priority = "high"
		title = "明天到期，优先安排"
	}
	if len(items) > 1 {
		body = fmt.Sprintf("【%s】等 %d 种食材即将到期，可安排食谱或标记已处理。", first.Name, len(items))
	} else {
		body = fmt.Sprintf("【%s】将于 %s 到期，可安排食谱或标记已处理。", first.Name, first.Expiration)
	}
	return title, body, priority
}

type expiryItem struct {
	ID         int
	UserID     int
	Name       string
	Expiration string
}

// RunNotificationsTask checks Expo receipts then sends expiring inventory pushes.
func (h *Handlers) RunNotificationsTask(ctx context.Context) (map[string]any, error) {
	checked, err := h.checkExpoPushReceipts(ctx)
	if err != nil {
		return map[string]any{"receiptsChecked": checked}, err
	}
	stats, err := h.sendExpiringInventoryNotifications(ctx)
	stats["receiptsChecked"] = checked
	return stats, err
}

func (h *Handlers) sendExpiringInventoryNotifications(ctx context.Context) (map[string]any, error) {
	out := map[string]any{"recipients": 0, "messages": 0, "failedRecipients": 0}
	if !h.hasTable("inventory_items") || !h.hasTable("notification_deliveries") {
		return out, nil
	}
	today := currentDateKey(time.Now())
	deadline := dateKeyAfterDays(today, 3)
	rows, err := h.DB.Query(`
		SELECT i.id, i.user_id, i.food_name, i.expiration_date
		FROM inventory_items i
		LEFT JOIN user_notification_preferences p ON p.user_id = i.user_id
		JOIN users u ON u.id = i.user_id AND COALESCE(u.is_disabled, 0) = 0
		WHERE COALESCE(i.is_available, 1) = 1
		  AND COALESCE(i.deleted_at, '') = ''
		  AND COALESCE(p.expiring_alert, 1) = 1
		  AND i.expiration_date IS NOT NULL
		  AND i.expiration_date >= ?
		  AND i.expiration_date <= ?
		ORDER BY i.user_id, i.expiration_date, i.id`, today, deadline)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	byUser := map[int][]expiryItem{}
	order := make([]int, 0)
	for rows.Next() {
		var item expiryItem
		var name, exp sql.NullString
		if err := rows.Scan(&item.ID, &item.UserID, &name, &exp); err != nil {
			continue
		}
		item.Name = name.String
		item.Expiration = exp.String
		if _, ok := byUser[item.UserID]; !ok {
			order = append(order, item.UserID)
		}
		byUser[item.UserID] = append(byUser[item.UserID], item)
	}

	type prepared struct {
		UserID         int
		NotificationID int64
		InventoryID    int
		Title          string
		Body           string
		Priority       string
		Tokens         []string
	}
	preparedUsers := make([]prepared, 0)

	for _, userID := range order {
		items := byUser[userID]
		inserted := 0
		for _, item := range items {
			res, err := h.DB.Exec(`INSERT INTO notification_deliveries
				(user_id, inventory_item_id, notification_type, delivery_date, status)
				VALUES (?, ?, 'expiring_inventory', ?, 'queued')
				ON CONFLICT(user_id, inventory_item_id, notification_type, delivery_date) DO NOTHING`,
				userID, item.ID, today)
			if err != nil {
				continue
			}
			if n, _ := res.RowsAffected(); n > 0 {
				inserted++
			}
		}
		if inserted == 0 {
			continue
		}
		title, body, priority := expiryContent(today, items)
		groupKey := "expiring:" + today
		var notificationID int64
		_ = h.DB.QueryRow(`SELECT id FROM user_notification_inbox WHERE user_id=? AND type='expiring_inventory' AND group_key=?`,
			userID, groupKey).Scan(&notificationID)
		if notificationID == 0 && h.inboxTableExists() {
			id, err := h.DB.InsertID(`INSERT INTO user_notification_inbox
				(user_id, type, title, body, category, inventory_item_id, group_key, priority)
				VALUES (?, 'expiring_inventory', ?, ?, 'action_required', ?, ?, ?)`,
				userID, title, body, items[0].ID, groupKey, priority)
			if err == nil {
				notificationID = id
			} else {
				// Fallback without optional columns.
				notificationID, _ = h.DB.InsertID(`INSERT INTO user_notification_inbox (user_id, type, title, body)
					VALUES (?, 'expiring_inventory', ?, ?)`, userID, title, body)
			}
		}
		if notificationID > 0 && h.hasTable("notification_inventory_items") {
			for _, item := range items {
				_, _ = h.DB.Exec(`INSERT INTO notification_inventory_items (notification_id, inventory_item_id, user_id)
					VALUES (?,?,?) ON CONFLICT DO NOTHING`, notificationID, item.ID, userID)
			}
		}
		tokens := h.activePushTokens(userID)
		preparedUsers = append(preparedUsers, prepared{
			UserID: userID, NotificationID: notificationID, InventoryID: items[0].ID,
			Title: title, Body: body, Priority: priority, Tokens: tokens,
		})
	}

	messages := make([]expoPushMessage, 0)
	ownerOf := make([]int, 0)
	for _, p := range preparedUsers {
		for _, token := range p.Tokens {
			if !isExpoPushToken(token) {
				continue
			}
			pri := "normal"
			if p.Priority == "urgent" || p.Priority == "high" {
				pri = "high"
			}
			messages = append(messages, expoPushMessage{
				To: token, Title: p.Title, Body: p.Body, Priority: pri,
				Data: map[string]any{
					"type": "expiring_inventory", "notificationId": p.NotificationID, "inventoryItemId": p.InventoryID,
				},
			})
			ownerOf = append(ownerOf, p.UserID)
		}
	}
	tickets, err := h.sendExpoPush(ctx, messages)
	if err != nil {
		return out, err
	}
	out["messages"] = len(messages)
	out["recipients"] = len(preparedUsers)

	statusByUser := map[int]string{}
	for i, ticket := range tickets {
		if i >= len(ownerOf) {
			break
		}
		uid := ownerOf[i]
		if ticket.Status == "ok" || ticket.Status == "" {
			statusByUser[uid] = "accepted"
			continue
		}
		if statusByUser[uid] != "accepted" {
			statusByUser[uid] = "failed"
		}
	}
	failed := 0
	for _, p := range preparedUsers {
		st := statusByUser[p.UserID]
		if st == "" {
			st = "inbox_only"
		}
		if st == "failed" {
			failed++
		}
		_, _ = h.DB.Exec(`UPDATE notification_deliveries SET status=?
			WHERE user_id=? AND notification_type='expiring_inventory' AND delivery_date=? AND status='queued'`,
			st, p.UserID, today)
	}
	out["failedRecipients"] = failed
	return out, nil
}

func (h *Handlers) activePushTokens(userID int) []string {
	if !h.hasTable("push_devices") {
		return nil
	}
	rows, err := h.DB.Query(`SELECT expo_push_token FROM push_devices WHERE user_id=? AND COALESCE(is_active,1)=1`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]string, 0)
	seen := map[string]struct{}{}
	for rows.Next() {
		var token string
		if rows.Scan(&token) != nil {
			continue
		}
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		if _, ok := seen[token]; ok {
			continue
		}
		seen[token] = struct{}{}
		out = append(out, token)
	}
	return out
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}
