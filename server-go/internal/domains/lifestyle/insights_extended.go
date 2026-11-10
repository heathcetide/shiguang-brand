// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) CreateInventoryOutcome(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	if key == "" {
		key = newUUID()
	}
	var existing sql.NullString
	if err := h.DB.QueryRow(`SELECT payload_json FROM inventory_outcome_events WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&existing); err == nil && existing.Valid {
		var parsed map[string]any
		if json.Unmarshal([]byte(existing.String), &parsed) == nil {
			c.JSON(http.StatusOK, gin.H{"event": parsed, "repeated": true})
			return
		}
	}
	eventID := newUUID()
	outcome := strings.TrimSpace(asString(body["outcome"]))
	if outcome == "" {
		outcome = "unknown"
	}
	occurred := strings.TrimSpace(asString(body["occurred_at"]))
	if occurred == "" {
		occurred = time.Now().UTC().Format(time.RFC3339)
	}
	event := map[string]any{
		"id": eventID, "user_id": userID, "outcome": outcome, "scope": "personal",
		"occurred_at": occurred, "version": 1,
	}
	event = mergeMaps(event, body)
	raw := marshalJSON(event)
	_, err := h.DB.Exec(`INSERT INTO inventory_outcome_events (id, user_id, idempotency_key, outcome, scope, occurred_at, payload_json)
		VALUES (?, ?, ?, ?, 'personal', ?, ?)`, eventID, userID, key, outcome, occurred, raw)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "记录结果失败", "OUTCOME_FAILED")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"event": event, "repeated": false})
}

func (h *Handlers) PatchInventoryOutcome(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	eventID := strings.TrimSpace(c.Param("id"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	var payload sql.NullString
	var version int
	err := h.DB.QueryRow(`SELECT payload_json, COALESCE(version,1) FROM inventory_outcome_events WHERE id=? AND user_id=?`, eventID, userID).Scan(&payload, &version)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "结果记录不存在", "OUTCOME_NOT_FOUND")
		return
	}
	if v := asInt(body["version"]); v > 0 && v != version {
		httpx.SendError(c, http.StatusConflict, "结果分类已更新，请刷新后重试", "OUTCOME_VERSION_CONFLICT")
		return
	}
	event := parseJSONObject(payload)
	event = mergeMaps(event, body)
	event["id"] = eventID
	event["version"] = version + 1
	raw := marshalJSON(event)
	_, _ = h.DB.Exec(`UPDATE inventory_outcome_events SET outcome=?, payload_json=?, version=? WHERE id=? AND user_id=?`,
		asString(event["outcome"]), raw, version+1, eventID, userID)
	c.JSON(http.StatusOK, event)
}

type insightOutcomeRow struct {
	outcome        string
	occurredAt     string
	expirationDate string
	source         string
	quantityValue  *float64
	quantityUnit   string
	foodName       string
	category       string
}

func insightsDateWindow(dateKey string, timezoneOffsetMinutes int) (start, end, previousStart, weekEndExclusive string, ok bool) {
	match := regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`).FindStringSubmatch(dateKey)
	if match == nil {
		return "", "", "", "", false
	}
	y, _ := strconv.Atoi(match[1])
	mo, _ := strconv.Atoi(match[2])
	d, _ := strconv.Atoi(match[3])
	localMidnight := time.Date(y, time.Month(mo), d, 0, 0, 0, 0, time.UTC).
		Add(-time.Duration(timezoneOffsetMinutes) * time.Minute)
	startT := localMidnight
	endT := localMidnight.Add(7 * 24 * time.Hour)
	prevT := localMidnight.Add(-7 * 24 * time.Hour)
	return startT.UTC().Format(time.RFC3339), endT.UTC().Format(time.RFC3339),
		prevT.UTC().Format(time.RFC3339), endT.Add(-time.Duration(timezoneOffsetMinutes) * time.Minute).UTC().Format("2006-01-02"), true
}

func (h *Handlers) listInsightOutcomes(userID int, scope, from, to string) []insightOutcomeRow {
	rows, err := h.DB.Query(`SELECT outcome, COALESCE(occurred_at,''), COALESCE(payload_json,'{}')
		FROM inventory_outcome_events
		WHERE user_id=? AND scope=? AND occurred_at >= ? AND occurred_at < ?`,
		userID, scope, from, to)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]insightOutcomeRow, 0)
	for rows.Next() {
		var outcome, occurred, payloadRaw string
		if rows.Scan(&outcome, &occurred, &payloadRaw) != nil {
			continue
		}
		row := insightOutcomeRow{outcome: outcome, occurredAt: occurred}
		var payload map[string]any
		if json.Unmarshal([]byte(payloadRaw), &payload) == nil && payload != nil {
			row.expirationDate = asString(payload["expirationDate"])
			if row.expirationDate == "" {
				row.expirationDate = asString(payload["expiration_date"])
			}
			row.source = asString(payload["source"])
			if qv := payload["quantityValue"]; qv != nil {
				v := asFloat(qv)
				row.quantityValue = &v
			}
			row.quantityUnit = asString(payload["quantityUnit"])
			row.foodName = asString(payload["foodName"])
			if row.foodName == "" {
				row.foodName = asString(payload["food_name"])
			}
			row.category = asString(payload["category"])
		}
		out = append(out, row)
	}
	return out
}

func summarizeInsightOutcomes(events []insightOutcomeRow, timezoneOffsetMinutes int) map[string]any {
	used, wasted, unknown, gifted := 0, 0, 0, 0
	timely, prompted := 0, 0
	qtyUsed := map[string]float64{}
	qtyWasted := map[string]float64{}
	for _, event := range events {
		switch event.outcome {
		case "cooked", "used":
			used++
			if event.expirationDate != "" {
				occurredDay := localInsightDate(event.occurredAt, timezoneOffsetMinutes)
				expDay := event.expirationDate
				days := (mustParseDay(expDay) - mustParseDay(occurredDay)) / 86400000
				if days >= 0 && days <= 3 {
					timely++
				}
			}
			if event.source == "reminder" || event.source == "recommendation" {
				prompted++
			}
			accumulateQty(qtyUsed, event)
		case "discarded", "expired":
			wasted++
			accumulateQty(qtyWasted, event)
		case "gifted", "transferred":
			gifted++
		default:
			unknown++
		}
	}
	return map[string]any{
		"usedCount": used, "wastedCount": wasted, "unknownCount": unknown,
		"giftedOrTransferredCount": gifted, "timelyUsedCount": timely, "promptedUseCount": prompted,
		"quantityTotals": map[string]any{"used": qtyUsed, "wasted": qtyWasted},
	}
}

func accumulateQty(target map[string]float64, event insightOutcomeRow) {
	if event.quantityValue == nil || event.quantityUnit == "" {
		return
	}
	target[event.quantityUnit] += *event.quantityValue
}

func localInsightDate(iso string, offsetMinutes int) string {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, iso)
	}
	if err != nil {
		return ""
	}
	return t.Add(-time.Duration(offsetMinutes) * time.Minute).UTC().Format("2006-01-02")
}

func mustParseDay(day string) int64 {
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		return 0
	}
	return t.UTC().UnixMilli()
}

func (h *Handlers) weeklyActionable(userID int, scope, weekStart string, summary map[string]any) []map[string]any {
	actionable := make([]map[string]any, 0)
	wasted := asInt(summary["wastedCount"])
	used := asInt(summary["usedCount"])
	if wasted > used && wasted > 0 {
		actionable = append(actionable, map[string]any{
			"kind": "high_waste", "wastedCount": wasted, "usedCount": used,
			"message": "本周浪费偏多，建议优先消耗临期食材",
		})
	}
	if used == 0 && wasted > 0 {
		actionable = append(actionable, map[string]any{
			"kind": "low_use", "wastedCount": wasted, "message": "本周几乎未记录有效消耗",
		})
	}
	if !h.hasTable("inventory_items") {
		return actionable
	}
	var category string
	var count int
	_ = h.DB.QueryRow(`SELECT COALESCE(category,''), COUNT(*) FROM inventory_items
		WHERE user_id=? AND COALESCE(is_available,1)=1 AND deleted_at IS NULL
			AND expiration_date >= ? AND expiration_date <= date(?, '+3 day')
		GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1`, userID, weekStart, weekStart).Scan(&category, &count)
	if count > 0 {
		actionable = append(actionable, map[string]any{
			"kind": "expiring_inventory", "category": category, "count": count,
			"message": fmt.Sprintf("未来 3 天有 %d 项%v库存到期", count, category),
		})
	}
	_ = scope
	return actionable
}

func (h *Handlers) WeeklyInventoryOutcomes(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	weekStart := strings.TrimSpace(c.Query("weekStart"))
	if weekStart == "" {
		httpx.SendError(c, http.StatusBadRequest, "周起始日期格式无效", "INVALID_WEEK_START")
		return
	}
	scope := c.Query("scope")
	if scope != "household" {
		scope = "personal"
	}
	if scope == "household" {
		hh := asInt(c.Query("householdId"))
		if hh <= 0 {
			httpx.SendError(c, http.StatusNotFound, "家庭报告不存在", "HOUSEHOLD_REPORT_NOT_FOUND")
			return
		}
	}
	offset := asInt(c.Query("timezoneOffsetMinutes"))
	if offset < -840 {
		offset = -840
	}
	if offset > 840 {
		offset = 840
	}
	start, end, prevStart, weekEndExclusive, ok := insightsDateWindow(weekStart, offset)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "周起始日期格式无效", "INVALID_WEEK_START")
		return
	}
	current := h.listInsightOutcomes(userID, scope, start, end)
	previousEvents := h.listInsightOutcomes(userID, scope, prevStart, start)
	summary := summarizeInsightOutcomes(current, offset)
	prevSummary := summarizeInsightOutcomes(previousEvents, offset)
	actionable := h.weeklyActionable(userID, scope, weekStart, summary)
	c.JSON(http.StatusOK, gin.H{
		"scope": scope, "householdId": nil, "weekStart": weekStart,
		"weekEndExclusive": weekEndExclusive, "summary": summary, "previousSummary": prevSummary,
		"trend": gin.H{
			"usedDelta": asInt(summary["usedCount"]) - asInt(prevSummary["usedCount"]),
			"wastedDelta": asInt(summary["wastedCount"]) - asInt(prevSummary["wastedCount"]),
			"timelyUsedDelta": asInt(summary["timelyUsedCount"]) - asInt(prevSummary["timelyUsedCount"]),
		},
		"actionable": actionable, "timezoneOffsetMinutes": offset,
	})
}
