// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	domainai "github.com/heathcetide/DietDigiDose/internal/domains/ai"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

const (
	aiDraftRevisionKey   = "ai.config.draft_revision"
	aiDraftStateKey      = "AI_CONFIGURATION_DRAFT_V1"
	aiResourceKey        = "AI_RESOURCE_CONFIG_V1"
	aiRuntimePolicyKey   = "AI_RUNTIME_POLICY"
	defaultPersonaPrompt = "你是「拾味助手」，一位专业的中式烹饪与健康饮食助手。回答简洁实用，优先考虑用户当前库存与安全饮食。"
)

var aiSettingKeys = map[string]string{
	"baseUrl":         "AI_BASE_URL",
	"model":           "AI_MODEL",
	"chatBaseUrl":     "AI_CHAT_BASE_URL",
	"chatModel":       "AI_CHAT_MODEL",
	"visionBaseUrl":   "AI_VISION_BASE_URL",
	"visionModel":     "AI_VISION_MODEL",
	"asrBaseUrl":      "AI_ASR_BASE_URL",
	"asrModel":        "AI_ASR_MODEL",
	"supervisorModel": "AI_SUPERVISOR_MODEL",
	"nutritionModel":  "AI_NUTRITION_MODEL",
	"recipeModel":     "AI_RECIPE_MODEL",
	"operationsModel": "AI_OPERATIONS_MODEL",
	"systemPrompt":    "AI_SYSTEM_PROMPT",
}

func (h *Handlers) draftRevision() int {
	if raw, ok := h.getSetting(aiDraftStateKey); ok {
		var draft map[string]any
		if json.Unmarshal([]byte(raw), &draft) == nil {
			if rev, ok := draft["revision"].(float64); ok {
				return int(rev)
			}
		}
	}
	if raw, ok := h.getSetting(aiDraftRevisionKey); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && n >= 0 {
			return n
		}
	}
	return 0
}

func (h *Handlers) bumpDraftRevision(expected int) (int, bool) {
	current := h.draftRevision()
	if expected >= 0 && expected != current {
		return current, false
	}
	next := current + 1
	h.upsertSetting(aiDraftRevisionKey, strconv.Itoa(next))
	return next, true
}

func defaultRuntimePolicy() map[string]any {
	return map[string]any{
		"main":          map[string]any{"thinking": "default", "maxTokens": 3000, "timeoutMs": 60000, "retries": 0},
		"planner":       map[string]any{"thinking": "default", "maxTokens": 3000, "timeoutMs": 60000, "retries": 0},
		"vision":        map[string]any{"thinking": "default", "maxTokens": 3000, "timeoutMs": 60000, "retries": 0},
		"asr":           map[string]any{"thinking": "default", "maxTokens": 3000, "timeoutMs": 60000, "retries": 0},
		"deadlineMs":    180000,
		"maxModelCalls": 12,
		"maxToolCalls":  6,
	}
}

func (h *Handlers) AIConfigGet(c *gin.Context) {
	cfg := domainai.LoadProviderConfig(h.DB)
	settings := h.aiSettingsMap()
	editable := map[string]any{}
	for name, key := range aiSettingKeys {
		editable[name] = settings[key]
	}
	if strings.TrimSpace(asString(editable["systemPrompt"])) == "" {
		editable["systemPrompt"] = defaultPersonaPrompt
	}
	draftRevision := h.draftRevision()
	masked := ""
	if cfg.APIKey != "" {
		masked = "********"
	}
	chatKey := firstNonEmpty(settings["AI_CHAT_API_KEY"], cfg.APIKey)
	visionKey := firstNonEmpty(settings["AI_VISION_API_KEY"], cfg.APIKey)
	asrKey := firstNonEmpty(settings["AI_ASR_API_KEY"], cfg.APIKey)
	visionCfg := cfg.ForVision()
	asrCfg := cfg.ForAsr()
	runtimePolicy := defaultRuntimePolicy()
	if raw := strings.TrimSpace(settings[aiRuntimePolicyKey]); raw != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			runtimePolicy = parsed
		}
	}
	supervisorModel := firstNonEmpty(settings["AI_SUPERVISOR_MODEL"], settings["AI_CHAT_MODEL"], settings["AI_MODEL"], cfg.ChatModel)
	nutritionModel := firstNonEmpty(settings["AI_NUTRITION_MODEL"], supervisorModel)
	recipeModel := firstNonEmpty(settings["AI_RECIPE_MODEL"], supervisorModel)
	operationsModel := firstNonEmpty(settings["AI_OPERATIONS_MODEL"], supervisorModel)
	c.JSON(http.StatusOK, gin.H{
		"editable":      editable,
		"draftRevision": draftRevision,
		"credentialState": map[string]bool{
			"global": cfg.APIKey != "",
			"chat":   chatKey != "",
			"vision": visionKey != "",
			"asr":    asrKey != "",
		},
		"hasApiKey":     cfg.APIKey != "",
		"maskedKey":     masked,
		"baseUrl":       cfg.BaseURL,
		"model":         cfg.ChatModel,
		"visionModel":   cfg.VisionModel,
		"asrModel":      cfg.AsrModel,
		"runtimePolicy": runtimePolicy,
		"effectiveModels": []map[string]any{
			{"role": "主助手", "model": supervisorModel, "source": "有效业务服务配置", "baseUrl": cfg.BaseURL},
			{"role": "规划", "model": nutritionModel, "source": "有效业务服务配置", "baseUrl": cfg.BaseURL},
			{"role": "图片", "model": cfg.VisionModel, "source": "有效业务服务配置", "baseUrl": visionCfg.BaseURL},
			{"role": "转写", "model": cfg.AsrModel, "source": "有效业务服务配置", "baseUrl": asrCfg.BaseURL},
			{"role": "对话", "model": cfg.ChatModel, "source": "有效业务服务配置", "baseUrl": cfg.BaseURL},
			{"role": "菜谱", "model": recipeModel, "source": "有效业务服务配置", "baseUrl": cfg.BaseURL},
			{"role": "运营", "model": operationsModel, "source": "有效业务服务配置", "baseUrl": cfg.BaseURL},
		},
		"agents": map[string]string{
			"supervisorModel": supervisorModel,
			"nutritionModel":  nutritionModel,
			"recipeModel":     recipeModel,
			"operationsModel": operationsModel,
		},
		"chat": map[string]any{
			"maskedKey": maskKey(chatKey), "hasApiKey": chatKey != "",
			"baseUrl": cfg.BaseURL, "model": cfg.ChatModel,
			"isCustomKey": settings["AI_CHAT_API_KEY"] != "", "isCustomUrl": settings["AI_CHAT_BASE_URL"] != "",
		},
		"vision": map[string]any{
			"maskedKey": maskKey(visionKey), "hasApiKey": visionKey != "",
			"baseUrl": visionCfg.BaseURL, "model": cfg.VisionModel,
			"isCustomKey": settings["AI_VISION_API_KEY"] != "", "isCustomUrl": settings["AI_VISION_BASE_URL"] != "",
		},
		"asr": map[string]any{
			"maskedKey": maskKey(asrKey), "hasApiKey": asrKey != "",
			"baseUrl": asrCfg.BaseURL, "model": cfg.AsrModel,
			"isCustomKey": settings["AI_ASR_API_KEY"] != "", "isCustomUrl": settings["AI_ASR_BASE_URL"] != "",
		},
		"systemPrompt":             firstNonEmpty(settings["AI_SYSTEM_PROMPT"], defaultPersonaPrompt),
		"isSystemPromptCustomized": strings.TrimSpace(settings["AI_SYSTEM_PROMPT"]) != "",
		"isConfiguredFromDB":       settings["AI_API_KEY"] != "",
	})
}

func (h *Handlers) aiSettingsMap() map[string]string {
	keys := []string{
		"AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_CHAT_API_KEY", "AI_CHAT_BASE_URL", "AI_CHAT_MODEL",
		"AI_VISION_API_KEY", "AI_VISION_BASE_URL", "AI_VISION_MODEL",
		"AI_ASR_API_KEY", "AI_ASR_BASE_URL", "AI_ASR_MODEL",
		"AI_SUPERVISOR_MODEL", "AI_NUTRITION_MODEL", "AI_RECIPE_MODEL", "AI_OPERATIONS_MODEL",
		"AI_SYSTEM_PROMPT", aiRuntimePolicyKey, aiResourceKey,
	}
	out := map[string]string{}
	for _, k := range keys {
		if v, ok := h.getSetting(k); ok {
			out[k] = v
		}
	}
	return out
}

func (h *Handlers) AIConfigPut(c *gin.Context) {
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	expected := intFromAny(body["draftRevision"])
	next, ok := h.bumpDraftRevision(expected)
	if !ok {
		httpx.SendError(c, http.StatusConflict, "配置版本已变更，请重新读取", "AI_RESOURCE_CONFLICT")
		return
	}
	settingMap := map[string]string{
		"apiKey": "AI_API_KEY", "baseUrl": "AI_BASE_URL", "model": "AI_MODEL",
		"chatApiKey": "AI_CHAT_API_KEY", "chatBaseUrl": "AI_CHAT_BASE_URL", "chatModel": "AI_CHAT_MODEL",
		"visionApiKey": "AI_VISION_API_KEY", "visionBaseUrl": "AI_VISION_BASE_URL", "visionModel": "AI_VISION_MODEL",
		"asrApiKey": "AI_ASR_API_KEY", "asrBaseUrl": "AI_ASR_BASE_URL", "asrModel": "AI_ASR_MODEL",
		"supervisorModel": "AI_SUPERVISOR_MODEL", "nutritionModel": "AI_NUTRITION_MODEL",
		"recipeModel": "AI_RECIPE_MODEL", "operationsModel": "AI_OPERATIONS_MODEL", "systemPrompt": "AI_SYSTEM_PROMPT",
	}
	wrote := false
	for field, key := range settingMap {
		if v, exists := body[field]; exists {
			h.upsertSetting(key, strings.TrimSpace(asString(v)))
			wrote = true
		}
	}
	if chatModel, exists := body["chatModel"]; exists {
		h.upsertSetting("AI_CHAT_MODEL", strings.TrimSpace(asString(chatModel)))
		h.upsertSetting("AI_MODEL", strings.TrimSpace(asString(chatModel)))
		wrote = true
	}
	if rp, exists := body["runtimePolicy"]; exists {
		raw, _ := json.Marshal(rp)
		h.upsertSetting(aiRuntimePolicyKey, string(raw))
		wrote = true
	}
	if !wrote {
		httpx.SendError(c, http.StatusBadRequest, "至少提供一个需要更新的字段", "INVALID_BODY")
		return
	}
	h.upsertSetting(aiDraftRevisionKey, strconv.Itoa(next))
	h.recordAudit(c, "ai_config.update", "ai_config", "global", "更新 AI 模型服务配置")
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "AI 草稿已保存，请在业务服务页测试并发布", "draftRevision": next})
}

func legacyResourceDocument() map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"revision":      0,
		"resources": []map[string]any{
			{"id": "legacy-chat", "name": "Legacy chat", "kind": "legacy", "scope": "chat"},
			{"id": "legacy-vision", "name": "Legacy vision", "kind": "legacy", "scope": "vision"},
			{"id": "legacy-asr", "name": "Legacy asr", "kind": "legacy", "scope": "asr"},
		},
		"defaults": map[string]any{
			"chat":   map[string]any{"resourceId": "legacy-chat"},
			"vision": map[string]any{"resourceId": "legacy-vision"},
			"asr":    map[string]any{"resourceId": "legacy-asr"},
		},
		"services": map[string]any{
			"chat": map[string]any{"inherit": true}, "vision": map[string]any{"inherit": true}, "asr": map[string]any{"inherit": true},
			"supervisor": map[string]any{"inherit": true}, "nutrition": map[string]any{"inherit": true},
			"recipe": map[string]any{"inherit": true}, "operations": map[string]any{"inherit": true},
		},
	}
}

func (h *Handlers) loadResourceDocument() map[string]any {
	if raw, ok := h.getSetting(aiResourceKey); ok && strings.TrimSpace(raw) != "" {
		var doc map[string]any
		if json.Unmarshal([]byte(raw), &doc) == nil {
			return doc
		}
	}
	return legacyResourceDocument()
}

func (h *Handlers) AIConfigResourcesGet(c *gin.Context) {
	doc := h.loadResourceDocument()
	cfg := domainai.LoadProviderConfig(h.DB)
	revision := intFromAny(doc["revision"])
	effective := map[string]any{
		"chat":       resourceEffective(cfg.BaseURL, cfg.ChatModel, cfg.APIKey != ""),
		"vision":     resourceEffective(cfg.ForVision().BaseURL, cfg.VisionModel, cfg.ForVision().APIKey != ""),
		"asr":        resourceEffective(cfg.ForAsr().BaseURL, cfg.AsrModel, cfg.ForAsr().APIKey != ""),
		"supervisor": resourceEffective(cfg.BaseURL, cfg.ChatModel, cfg.APIKey != ""),
		"nutrition":  resourceEffective(cfg.BaseURL, cfg.ChatModel, cfg.APIKey != ""),
		"recipe":     resourceEffective(cfg.BaseURL, cfg.ChatModel, cfg.APIKey != ""),
		"operations": resourceEffective(cfg.BaseURL, cfg.ChatModel, cfg.APIKey != ""),
		"search":     map[string]any{"status": "disabled"},
		"fetch":      map[string]any{"status": "disabled"},
	}
	catalog := []map[string]any{
		{"id": "chat", "capability": "chat", "input": "messages", "output": "chat-completion"},
		{"id": "vision", "capability": "vision", "input": "image-and-prompt", "output": "chat-completion"},
		{"id": "asr", "capability": "asr", "input": "audio", "output": "transcript"},
		{"id": "supervisor", "capability": "chat", "input": "messages", "output": "chat-completion"},
		{"id": "nutrition", "capability": "chat", "input": "messages", "output": "chat-completion"},
		{"id": "recipe", "capability": "chat", "input": "messages", "output": "chat-completion"},
		{"id": "operations", "capability": "chat", "input": "messages", "output": "chat-completion"},
		{"id": "search", "capability": "search", "kind": "tool", "input": "public-query", "output": "untrusted-web-results", "automaticExecution": false},
		{"id": "fetch", "capability": "fetch", "kind": "tool", "input": "public-url", "output": "untrusted-web-results", "automaticExecution": false},
	}
	c.JSON(http.StatusOK, gin.H{
		"schemaVersion": 1,
		"revision":      revision,
		"resources":     doc["resources"],
		"defaults":      doc["defaults"],
		"services":      doc["services"],
		"migrated":      h.getSettingExists(aiResourceKey),
		"catalog":       catalog,
		"effective":     effective,
		"lifecycle": h.resourceConfigResponse(revision)["lifecycle"],
	})
}

func resourceEffective(baseURL, model string, hasKey bool) map[string]any {
	return map[string]any{
		"resourceId": "legacy-chat", "model": model, "baseUrl": baseURL,
		"source": "legacy", "hasApiKey": hasKey,
	}
}

func maskKey(key string) string {
	if strings.TrimSpace(key) == "" {
		return ""
	}
	return "********"
}

func (h *Handlers) getSettingExists(key string) bool {
	_, ok := h.getSetting(key)
	return ok
}

func (h *Handlers) loadDraftState() map[string]any {
	if raw, ok := h.getSetting(aiDraftStateKey); ok && strings.TrimSpace(raw) != "" {
		var draft map[string]any
		if json.Unmarshal([]byte(raw), &draft) == nil {
			return draft
		}
	}
	return map[string]any{
		"revision": h.draftRevision(), "pending": false, "base": map[string]any{}, "values": map[string]any{},
	}
}

func (h *Handlers) saveDraftState(draft map[string]any) {
	raw, _ := json.Marshal(draft)
	h.upsertSetting(aiDraftStateKey, string(raw))
	h.upsertSetting(aiDraftRevisionKey, strconv.Itoa(intFromAny(draft["revision"])))
}

func (h *Handlers) AIConfigResourcesPut(c *gin.Context) {
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	doc := h.loadResourceDocument()
	draft := h.loadDraftState()
	expected := intFromAny(body["revision"])
	currentRev := intFromAny(draft["revision"])
	if currentRev == 0 {
		currentRev = intFromAny(doc["revision"])
	}
	if expected != currentRev {
		httpx.SendError(c, http.StatusConflict, "配置版本已变更，请重新读取", "AI_RESOURCE_CONFLICT")
		return
	}
	values := map[string]any{}
	if existing, ok := draft["values"].(map[string]any); ok {
		for k, v := range existing {
			values[k] = v
		}
	}
	nextDoc := map[string]any{}
	for k, v := range doc {
		nextDoc[k] = v
	}
	for _, k := range []string{"resources", "defaults", "services"} {
		if v, ok := body[k]; ok {
			nextDoc[k] = v
		}
	}
	nextDoc["revision"] = currentRev + 1
	values[aiResourceKey] = nextDoc
	draft["revision"] = currentRev + 1
	draft["pending"] = true
	draft["base"] = doc
	draft["values"] = values
	draft["test"] = nil
	h.saveDraftState(draft)
	h.recordAudit(c, "ai_resources.update", "ai_config", "global", "更新 AI 资源配置草稿")
	c.JSON(http.StatusOK, h.resourceConfigResponse(intFromAny(draft["revision"])))
}

func (h *Handlers) AIConfigResourcesAction(c *gin.Context) {
	parts := strings.Split(strings.Trim(c.Request.URL.Path, "/"), "/")
	action := parts[len(parts)-1]
	var body map[string]any
	_ = c.ShouldBindJSON(&body)
	revision := intFromAny(body["revision"])
	switch action {
	case "test":
		h.aiConfigResourcesTest(c, revision, body)
	case "migrate":
		if !h.getSettingExists(aiResourceKey) {
			raw, _ := json.Marshal(legacyResourceDocument())
			h.upsertSetting(aiResourceKey, string(raw))
		}
		h.AIConfigResourcesGet(c)
	case "publish":
		h.aiConfigResourcesPublish(c, revision)
	case "discard":
		h.aiConfigResourcesDiscard(c, revision)
	default:
		httpx.SendError(c, http.StatusBadRequest, "未知操作", "INVALID_ACTION")
	}
}

func (h *Handlers) resourceConfigResponse(revision int) map[string]any {
	doc := h.loadResourceDocument()
	draft := h.loadDraftState()
	pending := draft["pending"] == true
	if pending {
		if values, ok := draft["values"].(map[string]any); ok {
			if rawDoc, ok := values[aiResourceKey].(map[string]any); ok {
				doc = rawDoc
			}
		}
	}
	published := intFromAny(h.loadResourceDocument()["revision"])
	return map[string]any{
		"schemaVersion": 1, "revision": revision, "resources": doc["resources"], "defaults": doc["defaults"], "services": doc["services"],
		"migrated": h.getSettingExists(aiResourceKey), "catalog": []any{}, "effective": map[string]any{},
		"lifecycle": map[string]any{
			"pending": pending, "publishedRevision": published, "conflict": false,
			"test": draft["test"], "changedServices": []any{}, "changedSettings": []any{},
		},
	}
}

func (h *Handlers) aiConfigResourcesPublish(c *gin.Context, revision int) {
	draft := h.loadDraftState()
	if draft["pending"] != true || intFromAny(draft["revision"]) != revision {
		httpx.SendError(c, http.StatusConflict, "没有可发布的草稿或版本不匹配", "AI_RESOURCE_CONFLICT")
		return
	}
	test, _ := draft["test"].(map[string]any)
	if test == nil || intFromAny(test["revision"]) != revision || test["success"] != true {
		httpx.SendError(c, http.StatusConflict, "请先通过测试再发布", "AI_RESOURCE_TEST_REQUIRED")
		return
	}
	values, _ := draft["values"].(map[string]any)
	if values == nil {
		httpx.SendError(c, http.StatusConflict, "草稿内容为空", "AI_RESOURCE_CONFLICT")
		return
	}
	for key, value := range values {
		switch v := value.(type) {
		case string:
			h.upsertSetting(key, v)
		default:
			raw, _ := json.Marshal(v)
			h.upsertSetting(key, string(raw))
		}
	}
	cleared := map[string]any{
		"revision": revision + 1, "pending": false, "base": map[string]any{}, "values": map[string]any{},
	}
	h.saveDraftState(cleared)
	h.recordAudit(c, "ai_resources.publish", "ai_config", "global", "发布 AI 资源配置")
	c.JSON(http.StatusOK, h.resourceConfigResponse(revision+1))
}

func (h *Handlers) aiConfigResourcesDiscard(c *gin.Context, revision int) {
	draft := h.loadDraftState()
	if intFromAny(draft["revision"]) != revision {
		httpx.SendError(c, http.StatusConflict, "配置版本已变更，请重新读取", "AI_RESOURCE_CONFLICT")
		return
	}
	cleared := map[string]any{
		"revision": revision + 1, "pending": false, "base": map[string]any{}, "values": map[string]any{},
	}
	h.saveDraftState(cleared)
	h.recordAudit(c, "ai_resources.discard", "ai_config", "global", "丢弃 AI 配置草稿")
	c.JSON(http.StatusOK, h.resourceConfigResponse(revision+1))
}

func (h *Handlers) aiConfigResourcesTest(c *gin.Context, revision int, body map[string]any) {
	draft := h.loadDraftState()
	if draft["pending"] != true || intFromAny(draft["revision"]) != revision {
		httpx.SendError(c, http.StatusConflict, "没有可测试的草稿或版本不匹配", "AI_RESOURCE_CONFLICT")
		return
	}
	service := strings.TrimSpace(asString(body["service"]))
	if service == "" {
		service = "chat"
	}
	cfg := domainai.ProviderConfigWithOverrides(h.DB, flattenDraftSettingValues(draft))
	test := map[string]any{"revision": revision, "scope": "configuration-validation", "success": true, "service": service}
	if service == "chat" {
		test["scope"] = "connection-probe"
		start := time.Now()
		_, err := domainai.ChatCompletion(context.Background(), cfg, []domainai.ChatMessage{
			{Role: "user", Content: "ping"},
		}, domainai.ChatOptions{Model: cfg.ChatModel, MaxTokens: 16, Timeout: 15 * time.Second})
		test["success"] = err == nil
		test["latencyMs"] = time.Since(start).Milliseconds()
		if err != nil {
			test["error"] = err.Error()
		}
	} else if service == "vision" {
		probe := cfg.ForVision()
		test["success"] = strings.TrimSpace(probe.APIKey) != "" && strings.TrimSpace(probe.BaseURL) != "" && strings.TrimSpace(probe.VisionModel) != ""
	} else if service == "asr" {
		probe := cfg.ForAsr()
		test["success"] = strings.TrimSpace(probe.APIKey) != "" && strings.TrimSpace(probe.BaseURL) != "" && strings.TrimSpace(probe.AsrModel) != ""
	}
	draft["test"] = test
	h.saveDraftState(draft)
	h.recordAudit(c, "ai_resources.test", "ai_config", "global", "校验 AI 草稿")
	resp := h.resourceConfigResponse(revision)
	resp["ok"] = true
	resp["checked"] = test
	c.JSON(http.StatusOK, resp)
}

func flattenDraftSettingValues(draft map[string]any) map[string]string {
	out := map[string]string{}
	values, _ := draft["values"].(map[string]any)
	if values == nil {
		return out
	}
	for key, value := range values {
		switch v := value.(type) {
		case string:
			out[key] = v
		default:
			raw, err := json.Marshal(v)
			if err == nil {
				out[key] = string(raw)
			}
		}
	}
	return out
}

func (h *Handlers) AIConfigPostDeprecated(c *gin.Context) {
	c.JSON(http.StatusGone, gin.H{
		"message": "该接口已废弃，请使用 PUT /ai-config",
		"code":    "DEPRECATED",
	})
}

func (h *Handlers) AIConfigTest(c *gin.Context) {
	c.JSON(http.StatusGone, gin.H{
		"error": "请使用带草稿版本的 /ai-config/resources/test；此接口不再执行无版本连接测试",
	})
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
