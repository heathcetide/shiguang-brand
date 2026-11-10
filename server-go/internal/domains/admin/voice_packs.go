// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/domains/voicepacks"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) VoicePacksList(c *gin.Context) {
	voicepacks.EnsureSchema(h.DB)
	status := strings.TrimSpace(c.Query("status"))
	search := strings.TrimSpace(c.Query("search"))
	q := `SELECT ` + voicepacks.SelectColumnsConst() + ` FROM voice_pack_versions WHERE 1=1`
	args := make([]any, 0, 4)
	if status != "" {
		q += ` AND status=?`
		args = append(args, status)
	}
	if search != "" {
		like := "%" + search + "%"
		q += ` AND (voice_id LIKE ? OR name LIKE ? OR version LIKE ?)`
		args = append(args, like, like, like)
	}
	q += ` ORDER BY updated_at DESC, id DESC LIMIT 200`
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "authority": "database"})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		row, err := voicepacks.ScanRow(rows)
		if err != nil {
			continue
		}
		items = append(items, voicepacks.AdminItem(row))
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "authority": "database"})
}

func (h *Handlers) VoicePackHistory(c *gin.Context) {
	voicepacks.EnsureSchema(h.DB)
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	rows, err := h.DB.Query(`SELECT id, actor_user_id, from_status, to_status, reason, revision, created_at
		FROM voice_pack_status_history WHERE voice_pack_version_id=? ORDER BY id DESC`, id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var hid, actorID, revision int
		var fromStatus sql.NullString
		var toStatus, reason, created string
		if rows.Scan(&hid, &actorID, &fromStatus, &toStatus, &reason, &revision, &created) != nil {
			continue
		}
		var from any
		if fromStatus.Valid {
			from = fromStatus.String
		}
		items = append(items, map[string]any{
			"id": hid, "actorUserId": actorID, "fromStatus": from, "toStatus": toStatus,
			"reason": nullIfEmpty(reason), "revision": revision, "createdAt": created,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handlers) VoicePackCreate(c *gin.Context) {
	voicepacks.EnsureSchema(h.DB)
	adminID, _ := expressauth.UserID(c)
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	draft, ok := parseVoicePackDraft(body)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "音色包清单、HTTPS 资源、摘要或授权字段无效", "VOICE_PACK_VALIDATION_FAILED")
		return
	}
	res, err := h.DB.Exec(`INSERT INTO voice_pack_versions
		(voice_id, name, version, language, style_tags_json, manifest_json, resource_fingerprint, provider_voice, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		draft.voiceID, draft.name, draft.version, draft.language, draft.styleTagsJSON, draft.manifestJSON,
		draft.fingerprint, draft.providerVoice, adminID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			httpx.SendError(c, http.StatusConflict, "音色版本或资源已经存在", "VOICE_PACK_DUPLICATE")
			return
		}
		httpx.SendError(c, http.StatusInternalServerError, "创建语音包失败", "VOICE_PACK_FAILED")
		return
	}
	id, _ := res.LastInsertId()
	_, _ = h.DB.Exec(`INSERT INTO voice_pack_status_history
		(voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision)
		VALUES (?, ?, NULL, 'draft', '创建草稿', 1)`, id, adminID)
	h.recordAudit(c, "voice_pack.create", "voice_pack_version", strconv.FormatInt(id, 10), "创建音色包草稿")
	row, _ := h.loadVoicePackRow(int(id))
	if row == nil {
		c.JSON(http.StatusCreated, gin.H{"id": id, "status": "draft"})
		return
	}
	c.JSON(http.StatusCreated, voicepacks.AdminItem(row))
}

func (h *Handlers) VoicePackUpdate(c *gin.Context) {
	voicepacks.EnsureSchema(h.DB)
	adminID, _ := expressauth.UserID(c)
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	row, err := h.loadVoicePackRow(id)
	if err != nil || row == nil {
		httpx.SendError(c, http.StatusNotFound, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND")
		return
	}
	if strings.TrimSpace(asString(row["status"])) != "draft" {
		httpx.SendError(c, http.StatusConflict, "已进入发布流程的资源不可原地覆盖，请创建新版本", "VOICE_PACK_IMMUTABLE")
		return
	}
	revision := intFromAny(body["revision"])
	if revision != intFromAny(row["revision"]) {
		httpx.SendError(c, http.StatusConflict, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT")
		return
	}
	draft, ok := parseVoicePackDraft(body)
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "音色包清单、HTTPS 资源、摘要或授权字段无效", "VOICE_PACK_VALIDATION_FAILED")
		return
	}
	res, err := h.DB.Exec(`UPDATE voice_pack_versions SET voice_id=?, name=?, version=?, language=?,
		style_tags_json=?, manifest_json=?, resource_fingerprint=?, provider_voice=?, revision=revision+1, updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND revision=? AND status='draft'`,
		draft.voiceID, draft.name, draft.version, draft.language, draft.styleTagsJSON, draft.manifestJSON,
		draft.fingerprint, draft.providerVoice, id, revision)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			httpx.SendError(c, http.StatusConflict, "音色版本或资源已经存在", "VOICE_PACK_DUPLICATE")
			return
		}
		httpx.SendError(c, http.StatusInternalServerError, "更新失败", "VOICE_PACK_FAILED")
		return
	}
	if mustRows(res) == 0 {
		httpx.SendError(c, http.StatusConflict, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT")
		return
	}
	h.recordAudit(c, "voice_pack.update", "voice_pack_version", strconv.Itoa(id), "更新音色包草稿")
	_ = adminID
	row, _ = h.loadVoicePackRow(id)
	c.JSON(http.StatusOK, voicepacks.AdminItem(row))
}

func (h *Handlers) VoicePackPublish(c *gin.Context) {
	h.voicePackTransition(c, "published", "")
}

func (h *Handlers) VoicePackDisable(c *gin.Context) {
	h.voicePackTransition(c, "disabled", "")
}

func (h *Handlers) VoicePackRevoke(c *gin.Context) {
	h.voicePackTransition(c, "revoked", "")
}

func (h *Handlers) voicePackTransition(c *gin.Context, target, defaultReason string) {
	voicepacks.EnsureSchema(h.DB)
	adminID, _ := expressauth.UserID(c)
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	row, err := h.loadVoicePackRow(id)
	if err != nil || row == nil {
		httpx.SendError(c, http.StatusNotFound, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND")
		return
	}
	fromStatus := strings.TrimSpace(asString(row["status"]))
	revision := intFromAny(body["revision"])
	if revision != intFromAny(row["revision"]) {
		httpx.SendError(c, http.StatusConflict, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT")
		return
	}
	reason := strings.TrimSpace(asString(body["reason"]))
	if target != "published" && len(reason) < 4 {
		httpx.SendError(c, http.StatusBadRequest, "请填写状态变更原因", "VOICE_PACK_REASON_REQUIRED")
		return
	}
	if target == "published" && !contains([]string{"draft", "disabled"}, fromStatus) {
		httpx.SendError(c, http.StatusConflict, "当前状态不能发布", "VOICE_PACK_INVALID_TRANSITION")
		return
	}
	if target == "disabled" && fromStatus != "published" {
		httpx.SendError(c, http.StatusConflict, "仅已发布音色可以下架", "VOICE_PACK_INVALID_TRANSITION")
		return
	}
	if target == "revoked" && fromStatus == "revoked" {
		httpx.SendError(c, http.StatusConflict, "音色已经撤销", "VOICE_PACK_INVALID_TRANSITION")
		return
	}
	if reason == "" {
		reason = defaultReason
	}
	if target == "published" && reason == "" {
		reason = "发布审核通过"
	}
	res, err := h.DB.Exec(`UPDATE voice_pack_versions SET status=?, revision=revision+1, reviewed_by=?,
		published_at=CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE published_at END,
		revoked_at=CASE WHEN ?='revoked' THEN CURRENT_TIMESTAMP ELSE NULL END,
		revoke_reason=CASE WHEN ?='revoked' THEN ? ELSE NULL END,
		updated_at=CURRENT_TIMESTAMP
		WHERE id=? AND revision=? AND status=?`,
		target, adminID, target, target, target, reason, id, revision, fromStatus)
	if err != nil || mustRows(res) == 0 {
		httpx.SendError(c, http.StatusConflict, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT")
		return
	}
	_, _ = h.DB.Exec(`INSERT INTO voice_pack_status_history
		(voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision)
		VALUES (?, ?, ?, ?, ?, ?)`, id, adminID, fromStatus, target, reason, revision+1)
	if target == "revoked" {
		voiceID := asString(row["voice_id"])
		version := asString(row["version"])
		_, _ = h.DB.Exec(`UPDATE user_voice_preferences SET selected_voice_id=NULL, selected_version=NULL,
			version=version+1, updated_at=CURRENT_TIMESTAMP WHERE selected_voice_id=? AND selected_version=?`, voiceID, version)
	}
	h.recordAudit(c, "voice_pack."+target, "voice_pack_version", strconv.Itoa(id), "音色包状态变更")
	updated, _ := h.loadVoicePackRow(id)
	c.JSON(http.StatusOK, voicepacks.AdminItem(updated))
}

type voiceDraft struct {
	voiceID, name, version, language, styleTagsJSON, manifestJSON, fingerprint string
	providerVoice any
}

func parseVoicePackDraft(body map[string]any) (voiceDraft, bool) {
	manifest, ok := body["manifest"].(map[string]any)
	if !ok {
		return voiceDraft{}, false
	}
	voiceID := strings.TrimSpace(asString(manifest["voiceId"]))
	name := strings.TrimSpace(asString(manifest["name"]))
	version := strings.TrimSpace(asString(manifest["version"]))
	if voiceID == "" || name == "" || version == "" {
		return voiceDraft{}, false
	}
	language := strings.TrimSpace(asString(manifest["language"]))
	if language == "" {
		language = "zh-CN"
	}
	styleTags := []any{}
	if raw, ok := body["styleTags"].([]any); ok {
		seen := map[string]struct{}{}
		for _, t := range raw {
			tag := strings.TrimSpace(asString(t))
			if tag == "" || len(seen) >= 12 {
				continue
			}
			if _, dup := seen[tag]; dup {
				continue
			}
			seen[tag] = struct{}{}
			styleTags = append(styleTags, tag)
		}
	}
	styleJSON, _ := json.Marshal(styleTags)
	manifestJSON, _ := json.Marshal(manifest)
	var provider any
	if pv := strings.TrimSpace(asString(body["providerVoice"])); pv != "" {
		provider = pv
	}
	return voiceDraft{
		voiceID: voiceID, name: name, version: version, language: language,
		styleTagsJSON: string(styleJSON), manifestJSON: string(manifestJSON),
		fingerprint: voicepacks.ResourceFingerprint(manifest), providerVoice: provider,
	}, true
}

func (h *Handlers) loadVoicePackRow(id int) (map[string]any, error) {
	row := h.DB.QueryRow(`SELECT `+voicepacks.SelectColumnsConst()+` FROM voice_pack_versions WHERE id=?`, id)
	return voicepacks.ScanRow(row)
}

func intFromAny(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case int64:
		return int(t)
	default:
		return 0
	}
}

func contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}
