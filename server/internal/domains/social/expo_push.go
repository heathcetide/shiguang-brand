// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	expoPushSendURL     = "https://exp.host/--/api/v2/push/send"
	expoPushReceiptsURL = "https://exp.host/--/api/v2/push/getReceipts"
	expoPushBatchSize   = 100
)

var expoTokenRe = regexp.MustCompile(`^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$`)

type expoPushMessage struct {
	To         string         `json:"to"`
	Title      string         `json:"title"`
	Body       string         `json:"body"`
	Data       map[string]any `json:"data,omitempty"`
	Sound      string         `json:"sound,omitempty"`
	Priority   string         `json:"priority,omitempty"`
	CategoryID string         `json:"categoryId,omitempty"`
}

type expoTicket struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Details *struct {
		Error string `json:"error"`
	} `json:"details"`
}

func isExpoPushToken(token string) bool {
	return expoTokenRe.MatchString(strings.TrimSpace(token))
}

func (h *Handlers) sendExpoPush(ctx context.Context, messages []expoPushMessage) ([]expoTicket, error) {
	if len(messages) == 0 {
		return nil, nil
	}
	client := &http.Client{Timeout: 30 * time.Second}
	all := make([]expoTicket, 0, len(messages))
	for i := 0; i < len(messages); i += expoPushBatchSize {
		end := i + expoPushBatchSize
		if end > len(messages) {
			end = len(messages)
		}
		batch := messages[i:end]
		for j := range batch {
			if batch[j].Sound == "" {
				batch[j].Sound = "default"
			}
			if batch[j].Priority == "" {
				batch[j].Priority = "normal"
			}
			if typ, _ := batch[j].Data["type"].(string); typ == "expiring_inventory" && batch[j].CategoryID == "" {
				batch[j].CategoryID = "inventory-expiring"
			}
		}
		raw, _ := json.Marshal(batch)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushSendURL, bytes.NewReader(raw))
		if err != nil {
			return all, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return all, err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		if resp.StatusCode >= 300 {
			return all, fmt.Errorf("expo push send status=%d body=%s", resp.StatusCode, truncate(string(body), 200))
		}
		var parsed struct {
			Data []expoTicket `json:"data"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil {
			return all, err
		}
		tickets := parsed.Data
		for len(tickets) < len(batch) {
			tickets = append(tickets, expoTicket{Status: "error", Message: "missing ticket"})
		}
		h.recordPushTickets(batch, tickets)
		all = append(all, tickets[:len(batch)]...)
	}
	return all, nil
}

func (h *Handlers) recordPushTickets(messages []expoPushMessage, tickets []expoTicket) {
	if !h.hasTable("push_notification_receipts") {
		return
	}
	for i, msg := range messages {
		if i >= len(tickets) {
			break
		}
		ticket := tickets[i]
		if ticket.ID == "" {
			continue
		}
		userID := 0
		var notificationID any
		if id, ok := asInt(msg.Data["notificationId"]); ok && id > 0 {
			notificationID = id
		}
		_ = h.DB.QueryRow(`SELECT user_id FROM push_devices WHERE expo_push_token=? LIMIT 1`, msg.To).Scan(&userID)
		submit := ticket.Status
		if submit == "" {
			submit = "unknown"
		}
		_, _ = h.DB.Exec(`INSERT INTO push_notification_receipts
			(expo_ticket_id, user_id, notification_id, expo_push_token, submit_status, receipt_status)
			VALUES (?,?,?,?,?,'pending')
			ON CONFLICT(expo_ticket_id) DO UPDATE SET submit_status=excluded.submit_status`,
			ticket.ID, userID, notificationID, msg.To, submit)
		event := "push_submitted"
		if ticket.Status == "error" {
			event = "push_submit_failed"
			if ticket.Details != nil && ticket.Details.Error == "DeviceNotRegistered" {
				_, _ = h.DB.Exec(`UPDATE push_devices SET is_active=0 WHERE expo_push_token=?`, msg.To)
			}
		}
		if h.hasTable("notification_events") {
			meta, _ := json.Marshal(map[string]any{"status": ticket.Status, "message": ticket.Message})
			_, _ = h.DB.Exec(`INSERT INTO notification_events (user_id, notification_id, event_type, metadata_json, expo_ticket_id)
				VALUES (?,?,?,?,?)`, userID, notificationID, event, string(meta), ticket.ID)
		}
	}
}

func (h *Handlers) checkExpoPushReceipts(ctx context.Context) (checked int, err error) {
	if !h.hasTable("push_notification_receipts") {
		return 0, nil
	}
	before := time.Now().Add(-5 * time.Minute).UTC().Format("2006-01-02 15:04:05")
	rows, err := h.DB.Query(`SELECT expo_ticket_id, user_id, notification_id, expo_push_token
		FROM push_notification_receipts
		WHERE receipt_status='pending' AND created_at<=?
		ORDER BY created_at ASC LIMIT 300`, before)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	type pending struct {
		TicketID       string
		UserID         int
		NotificationID sql.NullInt64
		Token          string
	}
	list := make([]pending, 0, 64)
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.TicketID, &p.UserID, &p.NotificationID, &p.Token); err != nil {
			continue
		}
		list = append(list, p)
	}
	if len(list) == 0 {
		return 0, nil
	}
	ids := make([]string, 0, len(list))
	for _, p := range list {
		ids = append(ids, p.TicketID)
	}
	raw, _ := json.Marshal(map[string]any{"ids": ids})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushReceiptsURL, bytes.NewReader(raw))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = resp.Body.Close()
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("expo receipts status=%d", resp.StatusCode)
	}
	var parsed struct {
		Data map[string]expoTicket `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, err
	}
	for _, p := range list {
		ticket, ok := parsed.Data[p.TicketID]
		if !ok {
			continue
		}
		status := "failed"
		event := "push_delivery_failed"
		var errCode, errMsg any
		if ticket.Status == "ok" {
			status = "delivered"
			event = "push_delivered"
		} else {
			if ticket.Details != nil {
				errCode = ticket.Details.Error
				if ticket.Details.Error == "DeviceNotRegistered" {
					_, _ = h.DB.Exec(`UPDATE push_devices SET is_active=0 WHERE expo_push_token=?`, p.Token)
				}
			}
			errMsg = ticket.Message
		}
		_, _ = h.DB.Exec(`UPDATE push_notification_receipts
			SET receipt_status=?, error_code=?, error_message=?, checked_at=CURRENT_TIMESTAMP
			WHERE expo_ticket_id=?`, status, errCode, errMsg, p.TicketID)
		if h.hasTable("notification_events") {
			var notifID any
			if p.NotificationID.Valid {
				notifID = int(p.NotificationID.Int64)
			}
			_, _ = h.DB.Exec(`INSERT INTO notification_events (user_id, notification_id, event_type, expo_ticket_id)
				VALUES (?,?,?,?)`, p.UserID, notifID, event, p.TicketID)
		}
		checked++
	}
	return checked, nil
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	case string:
		var i int
		_, err := fmt.Sscanf(n, "%d", &i)
		return i, err == nil
	default:
		return 0, false
	}
}
