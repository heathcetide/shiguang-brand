// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/domains/voicepacks"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) VoicePacks(c *gin.Context) {
	voicepacks.EnsureSchema(h.DB)
	clientVersion := strings.TrimSpace(c.GetHeader("x-client-version"))
	if clientVersion == "" {
		clientVersion = "0.0.0"
	}
	rows, err := h.DB.Query(`SELECT ` + voicepacks.SelectColumnsConst() + ` FROM voice_pack_versions ORDER BY voice_id, id DESC`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"items": []any{}, "revoked": []any{}, "catalogVersion": "empty",
			"authority": "database", "syntheticVoiceDisclosure": disclosureText(),
		})
		return
	}
	defer rows.Close()
	allRows := make([]map[string]any, 0)
	for rows.Next() {
		row, err := voicepacks.ScanRow(rows)
		if err != nil {
			continue
		}
		allRows = append(allRows, row)
	}
	items := make([]map[string]any, 0)
	revoked := make([]map[string]any, 0)
	for _, row := range allRows {
		status := strings.TrimSpace(rowString(row, "status"))
		if status == "published" {
			item := voicepacks.ClientItem(row)
			if minVer, ok := item["minimumAppVersion"].(string); ok && minVer != "" && !appVersionAtLeast(clientVersion, minVer) {
				continue
			}
			items = append(items, item)
		}
		if status == "revoked" {
			revoked = append(revoked, map[string]any{
				"voiceId": row["voice_id"], "version": row["version"],
			})
		}
	}
	c.Header("ETag", `W/"voice-catalog-`+voicepacks.CatalogVersion(h.DB)+`"`)
	c.JSON(http.StatusOK, gin.H{
		"items": items, "revoked": revoked, "catalogVersion": voicepacks.CatalogVersion(h.DB),
		"authority": "database", "syntheticVoiceDisclosure": disclosureText(),
	})
}

func disclosureText() string {
	return "音色包生成的内容属于合成语音；模型文件安装到设备后可能被提取。"
}

func rowString(m map[string]any, key string) string {
	switch v := m[key].(type) {
	case string:
		return v
	case sql.NullString:
		if v.Valid {
			return v.String
		}
	}
	return ""
}

func appVersionAtLeast(current, required string) bool {
	if required == "" {
		return true
	}
	parse := func(v string) []int {
		parts := strings.Split(v, ".")
		out := make([]int, 3)
		for i := 0; i < len(parts) && i < 3; i++ {
			out[i], _ = strconvAtoi(parts[i])
		}
		return out
	}
	c := parse(current)
	r := parse(required)
	for i := 0; i < 3; i++ {
		if c[i] > r[i] {
			return true
		}
		if c[i] < r[i] {
			return false
		}
	}
	return true
}

func strconvAtoi(s string) (int, error) {
	var n int
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			break
		}
		n = n*10 + int(ch-'0')
	}
	return n, nil
}

func (h *Handlers) VoicePackPreferenceGet(c *gin.Context) {
	voicepacks.EnsureSchema(h.DB)
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var selectedVoiceID, selectedVersion, preference, updatedAt sql.NullString
	var version int
	err := h.DB.QueryRow(`SELECT selected_voice_id, selected_version, preference, version, updated_at
		FROM user_voice_preferences WHERE user_id=?`, userID).
		Scan(&selectedVoiceID, &selectedVersion, &preference, &version, &updatedAt)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, map[string]any{
			"selectedVoiceId": nil, "selectedVersion": nil, "preference": "automatic", "version": 0, "updatedAt": nil,
		})
		return
	}
	c.JSON(http.StatusOK, map[string]any{
		"selectedVoiceId": nullJSONStr(selectedVoiceID),
		"selectedVersion": nullJSONStr(selectedVersion),
		"preference":      nullOrDefault(preference, "automatic"),
		"version":         version,
		"updatedAt":       nullJSONStr(updatedAt),
	})
}

func (h *Handlers) VoicePackPreferencePut(c *gin.Context) {
	voicepacks.EnsureSchema(h.DB)
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	preference := strings.TrimSpace(asStringField(body, "preference"))
	if preference == "" {
		preference = "automatic"
	}
	if preference != "automatic" && preference != "system-only" {
		httpx.SendError(c, http.StatusBadRequest, "语音偏好无效", "INVALID_VOICE_PREFERENCE")
		return
	}
	voiceID := strings.TrimSpace(asStringField(body, "selectedVoiceId"))
	versionSel := strings.TrimSpace(asStringField(body, "selectedVersion"))
	expected := intFromBody(body["version"])
	if voiceID != "" || versionSel != "" {
		if voiceID == "" || versionSel == "" {
			httpx.SendError(c, http.StatusBadRequest, "所选音色未发布或已撤销", "VOICE_PACK_NOT_AVAILABLE")
			return
		}
		var id int
		err := h.DB.QueryRow(`SELECT id FROM voice_pack_versions WHERE voice_id=? AND version=? AND status='published'`, voiceID, versionSel).Scan(&id)
		if err != nil {
			httpx.SendError(c, http.StatusBadRequest, "所选音色未发布或已撤销", "VOICE_PACK_NOT_AVAILABLE")
			return
		}
	}
	var selectedVoice, selectedVersion sql.NullString
	var currentVersion int
	err := h.DB.QueryRow(`SELECT selected_voice_id, selected_version, version FROM user_voice_preferences WHERE user_id=?`, userID).
		Scan(&selectedVoice, &selectedVersion, &currentVersion)
	hasRow := err == nil
	if hasRow && expected != currentVersion {
		httpx.SendError(c, http.StatusConflict, "语音偏好已在其他设备更新", "VOICE_PREFERENCE_VERSION_CONFLICT")
		return
	}
	var vID, vVer any
	if voiceID != "" {
		vID = voiceID
		vVer = versionSel
	}
	if !hasRow {
		res, err := h.DB.Exec(`INSERT INTO user_voice_preferences (user_id, selected_voice_id, selected_version, preference)
			VALUES (?, ?, ?, ?)`, userID, vID, vVer, preference)
		if err != nil || rowsAffected(res) == 0 {
			httpx.SendError(c, http.StatusConflict, "语音偏好版本无效", "VOICE_PREFERENCE_VERSION_CONFLICT")
			return
		}
	} else {
		res, err := h.DB.Exec(`UPDATE user_voice_preferences SET selected_voice_id=?, selected_version=?, preference=?,
			version=version+1, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND version=?`,
			vID, vVer, preference, userID, expected)
		if err != nil || rowsAffected(res) == 0 {
			httpx.SendError(c, http.StatusConflict, "语音偏好已在其他设备更新", "VOICE_PREFERENCE_VERSION_CONFLICT")
			return
		}
	}
	h.VoicePackPreferenceGet(c)
}

func intFromBody(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	default:
		return 0
	}
}

func rowsAffected(res sql.Result) int64 {
	if res == nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return n
}

func nullJSONStr(v sql.NullString) any {
	if !v.Valid || strings.TrimSpace(v.String) == "" {
		return nil
	}
	return v.String
}

func nullOrDefault(v sql.NullString, def string) string {
	if !v.Valid || strings.TrimSpace(v.String) == "" {
		return def
	}
	return v.String
}

func (h *Handlers) VoicePackSynthesize(c *gin.Context) {
	var body struct {
		Text    string `json:"text"`
		VoiceID string `json:"voiceId"`
		Version string `json:"version"`
	}
	_ = c.ShouldBindJSON(&body)
	text := strings.TrimSpace(body.Text)
	if text == "" || len(text) > 600 {
		httpx.SendError(c, http.StatusBadRequest, "朗读文本需为 1-600 个字符", "INVALID_TTS_TEXT")
		return
	}
	voicepacks.EnsureSchema(h.DB)
	var providerVoice sql.NullString
	if strings.TrimSpace(body.VoiceID) != "" {
		err := h.DB.QueryRow(`SELECT provider_voice FROM voice_pack_versions WHERE voice_id=? AND status='published'
			AND (?='' OR version=?) ORDER BY id DESC LIMIT 1`,
			body.VoiceID, strings.TrimSpace(body.Version), strings.TrimSpace(body.Version)).Scan(&providerVoice)
		if err != nil {
			httpx.SendError(c, http.StatusBadRequest, "音色未发布或已撤销", "VOICE_PACK_NOT_AVAILABLE")
			return
		}
	}
	cfg := LoadProviderConfig(h.DB)
	ttsBase := strings.TrimRight(firstNonEmptyEnv(os.Getenv("TTS_BASE_URL"), os.Getenv("AI_BASE_URL"), cfg.BaseURL), "/")
	ttsKey := firstNonEmptyEnv(os.Getenv("TTS_API_KEY"), cfg.APIKey)
	if ttsKey == "" || !strings.HasPrefix(ttsBase, "http") {
		httpx.SendError(c, http.StatusServiceUnavailable, "云端语音暂不可用", "TTS_NOT_CONFIGURED")
		return
	}
	voice := firstNonEmptyEnv(os.Getenv("TTS_VOICE"), "alloy")
	if providerVoice.Valid && strings.TrimSpace(providerVoice.String) != "" {
		voice = providerVoice.String
	}
	model := firstNonEmptyEnv(os.Getenv("TTS_MODEL"), "gpt-4o-mini-tts")
	payload, _ := json.Marshal(map[string]any{
		"model": model, "voice": voice, "input": text, "response_format": "mp3",
	})
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ttsBase+"/audio/speech", bytes.NewReader(payload))
	if err != nil {
		httpx.SendError(c, http.StatusBadGateway, "云端语音生成失败", "TTS_UPSTREAM_FAILED")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ttsKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		httpx.SendError(c, http.StatusGatewayTimeout, "云端语音请求超时", "TTS_TIMEOUT")
		return
	}
	defer resp.Body.Close()
	audio, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || len(audio) == 0 || len(audio) > 8_000_000 {
		httpx.SendError(c, http.StatusBadGateway, "云端语音生成失败", "TTS_UPSTREAM_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"audioBase64": base64.StdEncoding.EncodeToString(audio),
		"mimeType":    "audio/mpeg",
		"source":      "server",
	})
}

func firstNonEmptyEnv(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
