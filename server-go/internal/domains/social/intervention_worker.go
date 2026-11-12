// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type proactivePrefs struct {
	Enabled           bool
	ExpiryRescue      bool
	DinnerWindow      bool
	TimeZone          string
	DinnerTime        string
	DinnerLeadMinutes int
}

func proactiveInterventionsEnabled() bool {
	if os.Getenv("PROACTIVE_INTERVENTIONS_ENABLED") == "1" {
		return true
	}
	if os.Getenv("PROACTIVE_INTERVENTIONS_ENABLED") == "0" {
		return false
	}
	env := strings.TrimSpace(os.Getenv("APP_ENVIRONMENT"))
	return env == "" || env == "dev" || env == "development" || env == "local"
}

func interventionScanInterval() time.Duration {
	sec := 60
	if raw := strings.TrimSpace(os.Getenv("INTERVENTION_SCAN_INTERVAL_SEC")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			sec = n
		}
	}
	return time.Duration(sec) * time.Second
}

func interventionIDFromSource(userID int, sourceKey string) string {
	payload, _ := json.Marshal([]any{userID, sourceKey})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func (h *Handlers) StartInterventionWorker(ctx context.Context) {
	if !proactiveInterventionsEnabled() {
		return
	}

	interval := interventionScanInterval()
	log.Printf("[intervention-worker] started interval=%s", interval)
	run := func() {
		scanned, created := h.runInterventionScanBatch()
		log.Printf("[intervention-worker] scan users=%d candidates=%d", scanned, created)
	}
	run() // immediate first pass
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("[intervention-worker] stopped")
			return
		case <-ticker.C:
			run()
		}
	}
}

func (h *Handlers) interventionScanCursor() int {
	if !h.hasTable("proactive_intervention_scan_cursor") {
		return 0
	}
	if h.hasColumn("proactive_intervention_scan_cursor", "user_id_cursor") {
		var cursor int
		_ = h.DB.QueryRow(`SELECT COALESCE(user_id_cursor,0) FROM proactive_intervention_scan_cursor WHERE id=1`).Scan(&cursor)
		return cursor
	}
	if h.hasColumn("proactive_intervention_scan_cursor", "after_user_id") {
		var cursor int
		_ = h.DB.QueryRow(`SELECT COALESCE(after_user_id,0) FROM proactive_intervention_scan_cursor WHERE name='opportunities'`).Scan(&cursor)
		return cursor
	}
	return 0
}

func (h *Handlers) advanceInterventionScanCursor(expected, next int) {
	if !h.hasTable("proactive_intervention_scan_cursor") {
		return
	}
	if h.hasColumn("proactive_intervention_scan_cursor", "user_id_cursor") {
		_, _ = h.DB.Exec(`UPDATE proactive_intervention_scan_cursor SET user_id_cursor=?, updated_at=CURRENT_TIMESTAMP WHERE id=1 AND user_id_cursor=?`,
			next, expected)
		return
	}
	if h.hasColumn("proactive_intervention_scan_cursor", "after_user_id") {
		_, _ = h.DB.Exec(`INSERT INTO proactive_intervention_scan_cursor(name) VALUES ('opportunities') ON CONFLICT(name) DO NOTHING`)
		_, _ = h.DB.Exec(`UPDATE proactive_intervention_scan_cursor SET after_user_id=?, updated_at=CURRENT_TIMESTAMP WHERE name='opportunities' AND after_user_id=?`,
			next, expected)
	}
}

func (h *Handlers) interventionScanUserIDs(afterID, limit int) []int {
	ids := make([]int, 0, limit)
	// Dev default: enroll inventory users into prefs before the prefs query, otherwise
	// once any prefs rows exist new users with stock are never scanned.
	if devDefaultInterventions() && h.hasTable("inventory_items") {
		rows, err := h.DB.Query(`SELECT DISTINCT user_id FROM inventory_items
			WHERE user_id>? AND deleted_at IS NULL ORDER BY user_id LIMIT ?`, afterID, limit)
		if err == nil {
			var pending []int
			for rows.Next() {
				var id int
				if rows.Scan(&id) == nil {
					pending = append(pending, id)
				}
			}
			_ = rows.Close()
			for _, id := range pending {
				h.ensureDefaultProactivePrefs(id)
			}
		}
	}
	if h.hasTable("proactive_intervention_preferences") {
		rows, err := h.DB.Query(`SELECT user_id FROM proactive_intervention_preferences
			WHERE enabled=1 AND (expiry_rescue=1 OR dinner_window=1) AND user_id>? ORDER BY user_id LIMIT ?`, afterID, limit)
		if err == nil {
			for rows.Next() {
				var id int
				if rows.Scan(&id) == nil {
					ids = append(ids, id)
				}
			}
			_ = rows.Close()
			if len(ids) > 0 {
				return ids
			}
		}
	}
	return ids
}

func devDefaultInterventions() bool {
	env := strings.TrimSpace(os.Getenv("APP_ENVIRONMENT"))
	return env == "" || env == "dev" || env == "development" || env == "local"
}

func (h *Handlers) ensureDefaultProactivePrefs(userID int) {
	if !h.hasTable("proactive_intervention_preferences") {
		return
	}
	_, _ = h.DB.Exec(`INSERT INTO proactive_intervention_preferences (user_id, enabled, expiry_rescue, dinner_window)
		VALUES (?, 1, 1, 1) ON CONFLICT(user_id) DO NOTHING`, userID)
}

func (h *Handlers) loadProactivePrefs(userID int) proactivePrefs {
	p := proactivePrefs{TimeZone: "Asia/Shanghai", DinnerTime: "18:00", DinnerLeadMinutes: 60, ExpiryRescue: true, DinnerWindow: true}
	if !h.hasTable("proactive_intervention_preferences") {
		return p
	}
	var enabled, expiry, dinner int
	var tz, dinnerTime sql.NullString
	var lead sql.NullInt64
	err := h.DB.QueryRow(`SELECT COALESCE(enabled,0), COALESCE(expiry_rescue,1), COALESCE(dinner_window,1),
		COALESCE(time_zone,'Asia/Shanghai'), COALESCE(dinner_time,'18:00'), COALESCE(dinner_lead_minutes,60)
		FROM proactive_intervention_preferences WHERE user_id=?`, userID).Scan(&enabled, &expiry, &dinner, &tz, &dinnerTime, &lead)
	if err != nil {
		if devDefaultInterventions() {
			h.ensureDefaultProactivePrefs(userID)
			p.Enabled = true
		}
		return p
	}
	p.Enabled = enabled == 1
	p.ExpiryRescue = expiry == 1
	p.DinnerWindow = dinner == 1
	if tz.Valid {
		p.TimeZone = tz.String
	}
	if dinnerTime.Valid {
		p.DinnerTime = dinnerTime.String
	}
	if lead.Valid && lead.Int64 > 0 {
		p.DinnerLeadMinutes = int(lead.Int64)
	}
	return p
}

func (h *Handlers) runInterventionScanBatch() (scanned, created int) {
	if h.DB == nil {
		return 0, 0
	}
	after := h.interventionScanCursor()
	users := h.interventionScanUserIDs(after, 25)
	if len(users) == 0 {
		h.advanceInterventionScanCursor(after, 0)
		return 0, 0
	}
	nextCursor := after
	for _, userID := range users {
		prefs := h.loadProactivePrefs(userID)
		if !prefs.Enabled {
			nextCursor = userID
			continue
		}
		n := h.scanUserInterventions(userID, prefs)
		created += n
		scanned++
		nextCursor = userID
	}
	if len(users) < 25 {
		nextCursor = 0
	}
	h.advanceInterventionScanCursor(after, nextCursor)
	return scanned, created
}

type interventionCandidate struct {
	SourceKey     string
	Kind          string
	Title         string
	Body          string
	WhyNow        string
	ExpiresLabel  string
	StartsAt      time.Time
	ExpiresAt     time.Time
	LocalDate     string
	InventoryIDs  []int
	RecipeIDs     []int
	Actions       []string
	PolicyVersion string
}

func (h *Handlers) scanUserInterventions(userID int, prefs proactivePrefs) int {
	created := 0
	today := todayDateKey()
	now := time.Now().UTC()
	if prefs.ExpiryRescue {
		if c, ok := h.buildExpiryRescueCandidate(userID, today, now); ok {
			if h.reserveProactiveIntervention(userID, c) {
				created++
			}
		}
	}
	if prefs.DinnerWindow && h.dinnerWindowOpen(prefs, today, now) && !h.hasActiveDinnerPlan(userID, today) {
		if c, ok := h.buildDinnerWindowCandidate(userID, today, now, prefs); ok {
			if h.reserveProactiveIntervention(userID, c) {
				created++
			}
		}
	}
	return created
}

func (h *Handlers) buildExpiryRescueCandidate(userID int, today string, now time.Time) (interventionCandidate, bool) {
	if !h.hasTable("inventory_items") {
		return interventionCandidate{}, false
	}
	horizon := now.AddDate(0, 0, 3).Format("2006-01-02")
	rows, err := h.DB.Query(`SELECT id, food_name, COALESCE(expiration_date,'')
		FROM inventory_items
		WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1
			AND expiration_date IS NOT NULL AND expiration_date != ''
			AND expiration_date >= ? AND expiration_date <= ?
		ORDER BY expiration_date ASC LIMIT 20`, userID, today, horizon)
	if err != nil {
		return interventionCandidate{}, false
	}
	ids := make([]int, 0)
	var firstExpiry string
	for rows.Next() {
		var id int
		var name, expiry string
		if rows.Scan(&id, &name, &expiry) != nil {
			continue
		}
		ids = append(ids, id)
		if firstExpiry == "" {
			firstExpiry = expiry
		}
	}
	_ = rows.Close()
	if len(ids) == 0 {
		return interventionCandidate{}, false
	}
	recipes := h.topRecipeMatchesForInventory(userID, ids, 3)
	if len(recipes) == 0 {
		return interventionCandidate{}, false
	}
	sourceKey := fmt.Sprintf("expiry_rescue:%d:%s", userID, today)
	start := now
	expire, _ := time.Parse("2006-01-02", firstExpiry)
	if expire.IsZero() {
		expire = now.Add(24 * time.Hour)
	} else {
		expire = expire.Add(24 * time.Hour)
	}
	return interventionCandidate{
		SourceKey: sourceKey, Kind: "expiry_rescue",
		Title: "有食材可以优先安排", Body: "查看临期食材与可做菜谱，选择今天的处理方案。",
		WhyNow:       fmt.Sprintf("%d 项仍可用食材将在三天内到期。", len(ids)),
		ExpiresLabel: fmt.Sprintf("最早到期日：%s（%s）", firstExpiry, "Asia/Shanghai"),
		StartsAt:     start, ExpiresAt: expire, LocalDate: today,
		InventoryIDs: ids, RecipeIDs: recipes,
		Actions:       []string{"plan_recipe", "view_alternatives", "mark_consumed", "mark_discarded", "snooze", "not_helpful"},
		PolicyVersion: "go-proactive-v1",
	}, true
}

func (h *Handlers) buildDinnerWindowCandidate(userID int, today string, now time.Time, prefs proactivePrefs) (interventionCandidate, bool) {
	recipes := h.topRecipeMatchesForInventory(userID, nil, 3)
	if len(recipes) == 0 {
		return interventionCandidate{}, false
	}
	dinnerAt, err := time.ParseInLocation("2006-01-02 15:04", today+" "+prefs.DinnerTime, interventionLocation(prefs.TimeZone))
	if err != nil {
		dinnerAt = now.Add(2 * time.Hour)
	}
	start := dinnerAt.Add(-time.Duration(prefs.DinnerLeadMinutes) * time.Minute)
	if now.Before(start) || !now.Before(dinnerAt) {
		return interventionCandidate{}, false
	}
	sourceKey := fmt.Sprintf("dinner_window:%d:%s", userID, today)
	return interventionCandidate{
		SourceKey: sourceKey, Kind: "dinner_window",
		Title: "现在可以安排晚餐", Body: "已有可执行的菜谱建议，查看并选择今晚的安排。",
		WhyNow:       "已进入你设置的晚餐决策窗口，该用餐日尚未安排或开始烹饪。",
		ExpiresLabel: fmt.Sprintf("%s %s 前（%s）", today, prefs.DinnerTime, prefs.TimeZone),
		StartsAt:     start.UTC(), ExpiresAt: dinnerAt.UTC(), LocalDate: today,
		RecipeIDs:     recipes,
		Actions:       []string{"plan_recipe", "view_alternatives", "not_cooking_today", "not_helpful"},
		PolicyVersion: "go-proactive-v1",
	}, true
}

func interventionLocation(tz string) *time.Location {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc, _ = time.LoadLocation("Asia/Shanghai")
	}
	return loc
}

func (h *Handlers) dinnerWindowOpen(prefs proactivePrefs, today string, now time.Time) bool {
	dinnerAt, err := time.ParseInLocation("2006-01-02 15:04", today+" "+prefs.DinnerTime, interventionLocation(prefs.TimeZone))
	if err != nil {
		return false
	}
	start := dinnerAt.Add(-time.Duration(prefs.DinnerLeadMinutes) * time.Minute)
	return !now.Before(start) && now.Before(dinnerAt)
}

func (h *Handlers) hasActiveDinnerPlan(userID int, date string) bool {
	if h.hasTable("meal_plan_items") {
		var n int
		q := `SELECT COUNT(*) FROM meal_plan_items WHERE user_id=? AND planned_date=? AND LOWER(COALESCE(meal_type,'')) IN ('dinner','晚餐') AND COALESCE(status,'') NOT IN ('skipped','cancelled')`
		_ = h.DB.QueryRow(q, userID, date).Scan(&n)
		if n > 0 {
			return true
		}
	}
	return false
}

func (h *Handlers) topRecipeMatchesForInventory(userID int, inventoryIDs []int, limit int) []int {
	if !h.hasTable("recipes") || !h.hasTable("inventory_items") {
		return nil
	}
	names := make([]string, 0)
	if len(inventoryIDs) > 0 {
		placeholders := strings.Repeat("?,", len(inventoryIDs))
		placeholders = strings.TrimSuffix(placeholders, ",")
		args := make([]any, len(inventoryIDs))
		for i, id := range inventoryIDs {
			args[i] = id
		}
		rows, err := h.DB.Query(`SELECT food_name FROM inventory_items WHERE id IN (`+placeholders+`)`, args...)
		if err == nil {
			for rows.Next() {
				var name string
				if rows.Scan(&name) == nil {
					names = append(names, name)
				}
			}
			_ = rows.Close()
		}
	} else {
		rows, err := h.DB.Query(`SELECT food_name FROM inventory_items
			WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1 LIMIT 30`, userID)
		if err == nil {
			for rows.Next() {
				var name string
				if rows.Scan(&name) == nil {
					names = append(names, name)
				}
			}
			_ = rows.Close()
		}
	}
	if len(names) == 0 {
		return nil
	}
	rows, err := h.DB.Query(`SELECT id, COALESCE(ingredients_json,'[]') FROM recipes ORDER BY id DESC LIMIT 80`)
	if err != nil {
		return nil
	}
	type hit struct {
		id    int
		score int
	}
	hits := make([]hit, 0)
	for rows.Next() {
		var id int
		var ing string
		if rows.Scan(&id, &ing) != nil {
			continue
		}
		score := scoreRecipeInventoryOverlap(ing, names)
		if score > 0 {
			hits = append(hits, hit{id: id, score: score})
		}
	}
	_ = rows.Close()
	for i := 0; i < len(hits); i++ {
		for j := i + 1; j < len(hits); j++ {
			if hits[j].score > hits[i].score {
				hits[i], hits[j] = hits[j], hits[i]
			}
		}
	}
	out := make([]int, 0, limit)
	for _, item := range hits {
		out = append(out, item.id)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func scoreRecipeInventoryOverlap(ingredientsJSON string, stock []string) int {
	var parsed []any
	if json.Unmarshal([]byte(ingredientsJSON), &parsed) != nil {
		return 0
	}
	if len(parsed) == 0 || len(stock) == 0 {
		return 0
	}
	matched := 0
	for _, item := range parsed {
		name := ""
		switch v := item.(type) {
		case string:
			name = v
		case map[string]any:
			name, _ = v["name"].(string)
		}
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" {
			continue
		}
		for _, s := range stock {
			ls := strings.ToLower(s)
			if strings.Contains(ls, name) || strings.Contains(name, ls) {
				matched++
				break
			}
		}
	}
	return matched
}

func (h *Handlers) reserveProactiveIntervention(userID int, c interventionCandidate) bool {
	if !h.hasTable("proactive_interventions") {
		return false
	}
	id := interventionIDFromSource(userID, c.SourceKey)
	var existing string
	err := h.DB.QueryRow(`SELECT id FROM proactive_interventions WHERE user_id=? AND source_key=?`, userID, c.SourceKey).Scan(&existing)
	if err == nil && existing != "" {
		return false
	}
	candidateJSON, _ := json.Marshal(map[string]any{
		"title": c.Title, "body": c.Body, "whyNow": c.WhyNow, "expiresLabel": c.ExpiresLabel,
		"localDate": c.LocalDate, "inventoryIds": c.InventoryIDs, "recipeIds": c.RecipeIDs, "actions": c.Actions,
	})
	invJSON, _ := json.Marshal(c.InventoryIDs)
	recJSON, _ := json.Marshal(c.RecipeIDs)
	now := nowRFC3339()
	deliveryState := "none"
	channel := "inbox_only"
	if len(h.activePushTokens(userID)) > 0 {
		deliveryState = "pending"
		channel = "push"
	}
	res, err := h.DB.Exec(`INSERT INTO proactive_interventions
		(id, user_id, source_key, kind, status, title, body, why_now, expires_label, starts_at, expires_at, local_date,
		 inventory_ids_json, recipe_ids_json, candidate_json, delivery_state, channel, next_attempt_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
		id, userID, c.SourceKey, c.Kind, c.Title, c.Body, c.WhyNow, c.ExpiresLabel,
		c.StartsAt.Format(time.RFC3339), c.ExpiresAt.Format(time.RFC3339), c.LocalDate,
		string(invJSON), string(recJSON), string(candidateJSON), deliveryState, channel, now, now, now)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return false
	}
	var notifID int64
	if h.inboxTableExists() {
		groupKey := "intervention:" + id
		notifID, err = h.DB.InsertID(`INSERT INTO user_notification_inbox (user_id, type, title, body, action_status)
			VALUES (?, 'proactive_intervention', ?, ?, 'pending')`, userID, c.Title, c.Body)
		if err == nil {

			_, _ = h.DB.Exec(`UPDATE user_notification_inbox SET category='action_required' WHERE id=?`, notifID)
			_ = groupKey
		}
	}
	if notifID > 0 {
		_, _ = h.DB.Exec(`UPDATE proactive_interventions SET notification_id=? WHERE id=? AND user_id=?`, notifID, id, userID)
	}
	return true
}
