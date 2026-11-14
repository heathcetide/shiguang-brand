// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
)

func asStringField(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := body[key].(string); ok {
			return v
		}
	}
	return ""
}

func asIntField(body map[string]any, keys ...string) int {
	for _, key := range keys {
		switch v := body[key].(type) {
		case int:
			return v
		case int64:
			return int(v)
		case float64:
			return int(v)
		case json.Number:
			n, _ := v.Int64()
			return int(n)
		case string:
			n, err := strconv.Atoi(strings.TrimSpace(v))
			if err == nil {
				return n
			}
		}
	}
	return 0
}

func optionalNumber(v any) *float64 {
	switch t := v.(type) {
	case nil:
		return nil
	case float64:
		return &t
	case float32:
		f := float64(t)
		return &f
	case int:
		f := float64(t)
		return &f
	case int64:
		f := float64(t)
		return &f
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return nil
		}
		return &f
	default:
		return nil
	}
}

func fallbackChatReply(userText string) string {
	userText = strings.TrimSpace(userText)
	if userText == "" {
		return "AI 服务尚未完成配置，请稍后重试或联系管理员。"
	}
	return fmt.Sprintf("收到您的咨询：「%s」。当前 AI 尚未配置，建议在设置中填写 API Key 后重试。", userText)
}

func fallbackNotConfiguredReply() string {
	return "AI 服务尚未完成配置，请稍后重试或联系管理员。"
}

func loadInventoryFoodNames(db *dbx.DB, userID int) []string {
	if db == nil {
		return nil
	}
	rows, err := db.Query(`SELECT food_name FROM inventory_items
		WHERE user_id=? AND COALESCE(is_available,1)=1 AND food_name IS NOT NULL AND TRIM(food_name)!=''
		ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 20`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	names := make([]string, 0, 20)
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil && strings.TrimSpace(name) != "" {
			names = append(names, strings.TrimSpace(name))
		}
	}
	return names
}

func buildChatSystemPrompt(cfg ProviderConfig, inventory []string) string {
	parts := []string{cfg.SystemPrompt}
	if len(inventory) > 0 {
		parts = append(parts, "用户当前库存食材（最多20项）："+strings.Join(inventory, "、"))
	}
	parts = append(parts, "回答使用简洁中文；涉及写库操作前先说明并等待用户确认。")
	return strings.Join(parts, "\n\n")
}

func parseJSONArrayFromModel(raw string) ([]map[string]any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty model output")
	}
	candidates := []string{raw}
	if m := regexp.MustCompile("(?s)```(?:json)?\\s*([^`]+)```").FindStringSubmatch(raw); len(m) > 1 {
		candidates = append([]string{strings.TrimSpace(m[1])}, candidates...)
	}
	if idx := strings.Index(raw, "["); idx >= 0 {
		if end := strings.LastIndex(raw, "]"); end > idx {
			candidates = append(candidates, raw[idx:end+1])
		}
	}
	for _, c := range candidates {
		var items []map[string]any
		if json.Unmarshal([]byte(c), &items) == nil && len(items) >= 0 {
			return items, nil
		}
		var wrapped map[string]any
		if json.Unmarshal([]byte(c), &wrapped) == nil {
			for _, key := range []string{"items", "foods", "lines", "data"} {
				if v, ok := wrapped[key]; ok {
					b, _ := json.Marshal(v)
					var arr []map[string]any
					if json.Unmarshal(b, &arr) == nil {
						return arr, nil
					}
				}
			}
		}
	}
	return nil, fmt.Errorf("could not parse JSON array")
}

func imageFromBody(body map[string]any) string {
	for _, key := range []string{"image", "imageBase64", "image_url", "imageUrl"} {
		if v, ok := body[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func decodeAudioFromRequest(body map[string]any, fileBytes []byte, fileMime string) ([]byte, string) {
	if len(fileBytes) > 0 {
		if fileMime == "" {
			fileMime = "audio/m4a"
		}
		return fileBytes, fileMime
	}
	for _, key := range []string{"audio", "audioBase64", "data"} {
		if s, ok := body[key].(string); ok && strings.TrimSpace(s) != "" {
			clean := strings.TrimSpace(s)
			mimeType := "audio/m4a"
			if strings.HasPrefix(clean, "data:") {
				if parts := strings.SplitN(clean, ",", 2); len(parts) == 2 {
					header := strings.TrimPrefix(parts[0], "data:")
					if i := strings.Index(header, ";"); i >= 0 {
						mimeType = header[:i]
					} else if header != "" {
						mimeType = header
					}
					clean = parts[1]
				}
			}
			if b, err := base64.StdEncoding.DecodeString(clean); err == nil {
				return b, mimeType
			}
		}
	}
	return nil, ""
}

func maybeCreateDietWritePreview(db *dbx.DB, userID int, userText string) map[string]any {
	if !regexp.MustCompile(`记录饮食|打卡|吃了|喝了`).MatchString(userText) {
		return nil
	}
	mealType := "午餐"
	switch {
	case strings.Contains(userText, "早"):
		mealType = "早餐"
	case strings.Contains(userText, "晚"):
		mealType = "晚餐"
	case strings.Contains(userText, "加餐") || strings.Contains(userText, "零食"):
		mealType = "加餐"
	}
	payload := map[string]any{
		"mealType": mealType, "foodName": "健康膳食", "amount": "1份",
		"calories": 350, "protein": 18, "carbs": 45, "fat": 10,
	}
	payloadBytes, _ := json.Marshal(payload)
	id := newRunID("wcf-")
	now := time.Now().UTC().Format(time.RFC3339Nano)
	expires := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano)
	if writeConfirmExpressShape(db) {
		_, _ = db.Exec(`INSERT INTO ai_write_confirmations
			(id, user_id, action, status, preview_payload_json, expires_at, created_at, updated_at)
			VALUES (?, ?, 'record_diet_meal', 'preview', ?, ?, ?, ?)`,
			id, userID, string(payloadBytes), expires, now, now)
	} else {
		_, _ = db.Exec(`INSERT INTO ai_write_confirmations (id, user_id, status, payload_json, created_at, updated_at)
			VALUES (?, ?, 'preview', ?, ?, ?)`, id, userID, string(payloadBytes), now, now)
	}
	return map[string]any{
		"confirmationId": id,
		"action":         "record_diet_meal",
		"payload":        payload,
		"expiresAt":      expires,
	}
}

func upsertInventoryScanJob(db *dbx.DB, jobID string, userID int, status, resultJSON, errMsg string) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var existing int
	_ = db.QueryRow(`SELECT COUNT(1) FROM inventory_scan_jobs WHERE id=?`, jobID).Scan(&existing)
	if existing > 0 {
		_, _ = db.Exec(`UPDATE inventory_scan_jobs SET status=?, result_json=?, error_message=?, updated_at=? WHERE id=? AND user_id=?`,
			status, resultJSON, errMsg, now, jobID, userID)
		return
	}
	_, _ = db.Exec(`INSERT INTO inventory_scan_jobs (id, user_id, status, result_json, error_message, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, jobID, userID, status, resultJSON, errMsg, now, now)
}

func insertAgentRunWithStatus(db *dbx.DB, id string, userID int, sessionID, modality, status, reply string, artifacts []any, failureReason string) {
	if failureReason != "" && reply == "" {
		reply = failureReason
	}
	insertAgentRun(db, id, userID, sessionID, modality, status, reply, artifacts)
	if failureReason == "" || !agentRunsExpressShape(db) {
		return
	}
	resultObj := map[string]any{"reply": reply, "artifacts": artifacts, "failureReason": failureReason, "fallback": failureReason != ""}
	resultJSON, _ := json.Marshal(resultObj)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, _ = db.Exec(`UPDATE agent_runs SET result_json=?, status=?, updated_at=? WHERE id=? AND user_id=?`,
		string(resultJSON), status, now, id, userID)
}

func visionFoodPrompt(userPrompt string) string {
	p := strings.TrimSpace(userPrompt)
	if p == "" {
		p = "识别餐食、分量与估算营养"
	}
	return p + "\n\n请仅输出 JSON 数组，每项字段：food_name（字符串）、quantity（字符串）、confidence（0-1 数字）、calories（数字，整份估算 kcal）、protein（数字，克）、carbs（数字，克）、fat（数字，克）。不要输出其它文字。"
}

func receiptScanPrompt() string {
	return "识别小票中的食品条目。仅输出 JSON 数组，每项含 food_name、quantity（含单位）、confidence（0-1）。不要输出其它文字。"
}

func inventoryScanPrompt() string {
	return "识别图片中可加入家庭库存的食品。仅输出 JSON 数组，每项含 food_name、quantity、storage_location、confidence（0-1）。不要输出其它文字。"
}

func runVisionItems(ctx context.Context, cfg ProviderConfig, image, prompt string) ([]map[string]any, string, error) {
	raw, err := AnalyzeImage(ctx, cfg, image, prompt, true)
	if err != nil {
		return nil, raw, err
	}
	items, parseErr := parseJSONArrayFromModel(raw)
	if parseErr != nil {
		return nil, raw, parseErr
	}
	return items, raw, nil
}

func readAllLimited(r io.Reader, limit int64) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r, limit))
}
