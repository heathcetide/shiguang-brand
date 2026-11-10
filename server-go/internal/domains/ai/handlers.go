// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"database/sql"
	"encoding/json"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

// Handlers covers simplified Go AI runtime routes (decision 1A).
type Handlers struct {
	DB    *dbx.DB
	Auth  *expressauth.Auth
	voice *voiceStore
}

// RegisterOn mounts /api/v1/ai routes.
func (h *Handlers) RegisterOn(engine *gin.Engine) {

	if h.voice == nil {
		h.voice = newVoiceStore()
	}
	auth := h.Auth.Middleware()

	ai := engine.Group("/api/v1/ai")
	ai.Use(auth)
	{
		ai.POST("/chat", h.Chat)
		ai.DELETE("/chat-conversations/:sessionId", h.DeleteConversation)
		ai.POST("/home-recommendations", h.HomeRecommendations)
		ai.POST("/vision-food", h.VisionFood)
		ai.POST("/inventory-scan-jobs", h.InventoryScanCreate)
		ai.GET("/inventory-scan-jobs/:jobId", h.InventoryScanGet)
		ai.POST("/scan-receipt", h.ScanReceipt)
		ai.POST("/voice-command", h.VoiceCommand)
		ai.POST("/transcribe", h.Transcribe)
		ai.POST("/write-confirmations/:confirmationId/commit", h.WriteConfirmCommit)

		runs := ai.Group("/agent-runs")
		{
			runs.GET("/:runId", h.AgentRunGet)
			runs.GET("/:runId/media", h.AgentRunMedia)
			runs.POST("/:runId/resume", h.AgentRunResume)
			runs.POST("/:runId/cancel", h.AgentRunCancel)
			runs.POST("/:runId/retry", h.AgentRunRetry)
			runs.POST("/:runId/undo", h.AgentRunUndo)
		}

		rv := ai.Group("/realtime-voice")
		{
			rv.POST("/sessions", h.RealtimeVoiceCreateSession)
			rv.POST("/sessions/:sessionId/heartbeat", h.RealtimeVoiceHeartbeat)
			rv.POST("/sessions/:sessionId/audio-chunks", h.RealtimeVoiceAudioChunk)
			rv.POST("/sessions/:sessionId/turns", h.RealtimeVoiceTurn)
			rv.GET("/sessions/:sessionId/events", h.RealtimeVoiceEvents)
			rv.GET("/sessions/:sessionId/stream", h.RealtimeVoiceStream)
			rv.DELETE("/sessions/:sessionId", h.RealtimeVoiceDeleteSession)
		}
	}

	voice := engine.Group("/api/v1/ai/voice-packs")
	voice.Use(auth)
	{
		voice.GET("", h.VoicePacks)
		voice.GET("/preference", h.VoicePackPreferenceGet)
		voice.PUT("/preference", h.VoicePackPreferencePut)
		voice.POST("/synthesize", h.VoicePackSynthesize)
	}
}

func (h *Handlers) Chat(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var rawBody map[string]any
	_ = c.ShouldBindJSON(&rawBody)
	message := strings.TrimSpace(asStringField(rawBody, "message", "prompt"))
	sessionID := strings.TrimSpace(asStringField(rawBody, "sessionId"))
	image := imageFromBody(rawBody)
	var priorMessages []ChatMessage
	if raw, ok := rawBody["messages"].([]any); ok {
		for _, entry := range raw {
			m, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			role, _ := m["role"].(string)
			content := m["content"]
			if role != "" {
				priorMessages = append(priorMessages, ChatMessage{Role: role, Content: content})
			}
		}
	}
	if message == "" {
		for i := len(priorMessages) - 1; i >= 0; i-- {
			if priorMessages[i].Role == "user" {
				if s, ok := priorMessages[i].Content.(string); ok {
					message = strings.TrimSpace(s)
					break
				}
			}
		}
	}
	if sessionID == "" {
		sessionID = "session-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}

	cfg := LoadProviderConfig(h.DB)
	runID := newRunID("run-")
	modality := chatModality(h.DB)
	ctx := c.Request.Context()

	var reply string
	var fallback bool
	var failureReason string
	artifacts := []any{}

	if strings.TrimSpace(message) != "" || image != "" {
		inventory := loadInventoryFoodNames(h.DB, userID)
		systemPrompt := buildChatSystemPrompt(cfg, inventory)
		messages := make([]ChatMessage, 0, len(priorMessages)+3)
		messages = append(messages, ChatMessage{Role: "system", Content: systemPrompt})
		for _, m := range priorMessages {
			if m.Role != "" {
				messages = append(messages, m)
			}
		}
		if message != "" {
			if image != "" {
				imageURL := image
				if !strings.HasPrefix(imageURL, "http") && !strings.HasPrefix(imageURL, "data:") {
					imageURL = "data:image/jpeg;base64," + image
				}
				messages = append(messages, ChatMessage{Role: "user", Content: []map[string]any{
					{"type": "text", "text": message},
					{"type": "image_url", "image_url": map[string]string{"url": imageURL}},
				}})
			} else {
				messages = append(messages, ChatMessage{Role: "user", Content: message})
			}
		}
		callCfg := cfg
		opts := ChatOptions{Model: cfg.ChatModel, MaxTokens: 2048}
		if image != "" {
			callCfg = cfg.ForVision()
			opts.Model = cfg.VisionModel
			opts.Timeout = 90 * time.Second
		}
		text, err := ChatCompletion(ctx, callCfg, messages, opts)
		if err != nil {
			if isNotConfigured(err) {
				reply = fallbackNotConfiguredReply()
				fallback = true
				failureReason = errAINotConfigured
			} else {
				reply = fallbackChatReply(message)
				fallback = true
				failureReason = "AI_REQUEST_FAILED"
			}
		} else {
			reply = text
		}
	} else {
		reply = fallbackChatReply("")
		fallback = true
		failureReason = errAINotConfigured
	}

	status := "completed"
	if failureReason != "" && !fallback {
		status = "failed"
	}
	insertAgentRunWithStatus(h.DB, runID, userID, sessionID, modality, status, reply, artifacts, failureReason)

	if message != "" {
		_, _ = h.DB.Exec(`INSERT INTO ai_chat_messages (user_id, session_id, role, content) VALUES (?, ?, 'user', ?)`, userID, sessionID, message)
	}
	_, _ = h.DB.Exec(`INSERT INTO ai_chat_messages (user_id, session_id, role, content) VALUES (?, ?, 'assistant', ?)`, userID, sessionID, reply)

	run, _ := getAgentRun(h.DB, runID, userID)
	if run == nil {
		run = map[string]any{"id": runID, "sessionId": sessionID, "modality": modality, "status": status, "reply": reply}
	}

	var writeConfirmation map[string]any
	if wc := maybeCreateDietWritePreview(h.DB, userID, message); wc != nil {
		writeConfirmation = wc
	}

	if wantsJSONResponse(c.GetHeader("Accept")) {
		payload := gin.H{
			"mode":            "agent",
			"run":             run,
			"reply":           reply,
			"sessionId":       sessionID,
			"artifacts":       artifacts,
			"solutionCards":   []any{},
			"pendingApproval": nil,
		}
		if fallback {
			payload["fallback"] = true
			if failureReason != "" {
				payload["failureReason"] = failureReason
			}
		}
		if writeConfirmation != nil {
			payload["writeConfirmation"] = writeConfirmation
		}
		c.JSON(http.StatusOK, payload)
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)
	_, _ = c.Writer.Write([]byte("data: {\"type\":\"token\",\"text\":" + strconv.Quote(reply) + "}\n\n"))
	_, _ = c.Writer.Write([]byte("data: {\"type\":\"done\",\"sessionId\":" + strconv.Quote(sessionID) + ",\"runId\":" + strconv.Quote(runID) + "}\n\n"))
	if f, ok := c.Writer.(http.Flusher); ok {
		f.Flush()
	}
}

func (h *Handlers) DeleteConversation(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID := c.Param("sessionId")
	_, _ = h.DB.Exec(`DELETE FROM ai_chat_messages WHERE user_id=? AND session_id=?`, userID, sessionID)
	c.JSON(http.StatusOK, gin.H{"deleted": true, "success": true})
}

func (h *Handlers) HomeRecommendations(c *gin.Context) {
	rows, err := h.DB.Query(`SELECT id, title FROM recipes ORDER BY id DESC LIMIT 8`)
	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var title string
			if rows.Scan(&id, &title) == nil {
				items = append(items, map[string]any{"id": id, "title": title})
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "source": "go-ai-runtime"})
}

func (h *Handlers) VisionFood(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	image := imageFromBody(body)
	if image == "" {
		httpx.SendError(c, http.StatusBadRequest, "缺少图片数据", "INVALID_BODY")
		return
	}
	userPrompt, _ := body["userPrompt"].(string)
	cfg := LoadProviderConfig(h.DB)
	runID := newRunID("run-")
	ctx := c.Request.Context()

	items, raw, err := runVisionItems(ctx, cfg, image, visionFoodPrompt(userPrompt))
	provider := providerName(cfg)
	status := "completed"
	reply := ""
	var artifacts []any
	if err != nil {
		if isNotConfigured(err) {
			c.JSON(http.StatusOK, gin.H{
				"items": []any{}, "provider": provider, "mode": "agent", "fallback": true,
				"failureReason": errAINotConfigured, "reply": fallbackNotConfiguredReply(),
			})
			return
		}
		status = "failed"
		reply = err.Error()
		insertAgentRunWithStatus(h.DB, runID, userID, runID, "vision", status, reply, nil, "AI_REQUEST_FAILED")
		httpx.SendError(c, http.StatusBadGateway, "视觉识别失败", "AI_REQUEST_FAILED")
		return
	}
	artifacts = []any{map[string]any{"type": "vision", "data": map[string]any{"items": items, "raw": raw}}}
	insertAgentRunWithStatus(h.DB, runID, userID, runID, "vision", status, reply, artifacts, "")
	run, _ := getAgentRun(h.DB, runID, userID)
	c.JSON(http.StatusOK, gin.H{
		"items": items, "provider": provider, "mode": "agent", "run": run, "success": true,
	})
}

func (h *Handlers) InventoryScanCreate(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	image := imageFromBody(body)
	if image == "" {
		httpx.SendError(c, http.StatusBadRequest, "缺少图片数据", "INVALID_BODY")
		return
	}
	if len(image) > 7_500_000 {
		httpx.SendError(c, http.StatusRequestEntityTooLarge, "图片过大", "IMAGE_TOO_LARGE")
		return
	}

	cfg := LoadProviderConfig(h.DB)
	jobID := newRunID("run-")
	ctx := c.Request.Context()

	items, _, err := runVisionItems(ctx, cfg, image, inventoryScanPrompt())
	status := "completed"
	resultObj := map[string]any{"items": items}
	if err != nil {
		status = "failed"
		resultObj = map[string]any{"items": []any{}, "error": err.Error()}
	}
	resultBytes, _ := json.Marshal(resultObj)
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	upsertInventoryScanJob(h.DB, jobID, userID, status, string(resultBytes), errMsg)

	artifacts := []any{
		map[string]any{"type": "vision", "data": map[string]any{"items": items}},
		map[string]any{"kind": "inventory_scan", "jobId": jobID},
	}
	runStatus := status
	if status == "failed" {
		runStatus = "failed"
	}
	insertAgentRunWithStatus(h.DB, jobID, userID, jobID, "inventory_scan", runStatus, "", artifacts, errMsg)

	httpStatus := http.StatusAccepted
	if status == "completed" {
		httpStatus = http.StatusAccepted
	}
	run, _ := getAgentRun(h.DB, jobID, userID)
	c.JSON(httpStatus, gin.H{"jobId": jobID, "status": status, "mode": "agent", "run": run})
}

func (h *Handlers) InventoryScanGet(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	jobID := c.Param("jobId")
	var status, result, errMsg sql.NullString
	err := h.DB.QueryRow(`SELECT status, COALESCE(result_json,''), COALESCE(error_message,'')
		FROM inventory_scan_jobs WHERE id=? AND user_id=?`, jobID, userID).
		Scan(&status, &result, &errMsg)
	if err != nil {
		if run, ok := getAgentRun(h.DB, jobID, userID); ok {
			items := []any{}
			if arts, ok := run["artifacts"].([]any); ok {
				for _, a := range arts {
					am, _ := a.(map[string]any)
					if am["type"] == "vision" {
						if data, _ := am["data"].(map[string]any); data != nil {
							if it, ok := data["items"].([]any); ok {
								items = it
							}
						}
					}
				}
			}
			c.JSON(http.StatusOK, gin.H{"jobId": jobID, "status": run["status"], "items": items, "mode": "agent", "run": run})
			return
		}
		httpx.SendError(c, http.StatusNotFound, "识别任务不存在", "SCAN_JOB_NOT_FOUND")
		return
	}
	items := []any{}
	if result.Valid && result.String != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(result.String), &parsed) == nil {
			if rawItems, ok := parsed["items"]; ok {
				if arr, ok := rawItems.([]any); ok {
					items = arr
				}
			}
		}
	}
	run, _ := getAgentRun(h.DB, jobID, userID)
	resp := gin.H{"jobId": jobID, "status": nullStr(status), "items": items, "mode": "agent", "run": run}
	if errMsg.Valid && errMsg.String != "" {
		resp["error"] = errMsg.String
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handlers) ScanReceipt(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	image := imageFromBody(body)
	if image == "" {
		httpx.SendError(c, http.StatusBadRequest, "缺少图片数据", "INVALID_BODY")
		return
	}
	cfg := LoadProviderConfig(h.DB)
	runID := newRunID("run-")
	ctx := c.Request.Context()
	items, _, err := runVisionItems(ctx, cfg, image, receiptScanPrompt())
	provider := providerName(cfg)
	if err != nil {
		if isNotConfigured(err) {
			c.JSON(http.StatusOK, gin.H{"items": []any{}, "provider": provider, "fallback": true, "failureReason": errAINotConfigured})
			return
		}
		insertAgentRunWithStatus(h.DB, runID, userID, runID, "receipt", "failed", err.Error(), nil, "AI_REQUEST_FAILED")
		httpx.SendError(c, http.StatusBadGateway, "小票识别失败", "AI_REQUEST_FAILED")
		return
	}
	artifacts := []any{map[string]any{"type": "receipt", "data": map[string]any{"items": items}}}
	insertAgentRunWithStatus(h.DB, runID, userID, runID, "receipt", "completed", "", artifacts, "")
	run, _ := getAgentRun(h.DB, runID, userID)
	c.JSON(http.StatusOK, gin.H{"items": items, "provider": provider, "mode": "agent", "run": run, "success": true})
}

func (h *Handlers) VoiceCommand(c *gin.Context) {
	_, _ = expressauth.UserID(c)
	var body map[string]any
	_ = c.ShouldBindJSON(&body)
	cfg := LoadProviderConfig(h.DB)
	ctx := c.Request.Context()

	audioBytes, mimeType := decodeAudioFromRequest(body, nil, "")
	if len(audioBytes) == 0 {
		if fh, err := c.FormFile("file"); err == nil && fh != nil {
			f, err := fh.Open()
			if err == nil {
				defer f.Close()
				audioBytes, _ = readAllLimited(f, 25<<20)
				mimeType = fh.Header.Get("Content-Type")
			}
		}
	}
	transcript := strings.TrimSpace(asStringField(body, "speechText", "text"))
	if transcript == "" && len(audioBytes) > 0 {
		text, err := Transcribe(ctx, cfg.ForAsr(), audioBytes, mimeType, "")
		if err != nil && !isNotConfigured(err) {
			c.JSON(http.StatusOK, gin.H{"intent": "unknown", "reply": "语音识别失败，请重试。", "transcript": "", "failureReason": "AI_REQUEST_FAILED"})
			return
		}
		if err == nil {
			transcript = text
		}
	}
	if transcript == "" {
		c.JSON(http.StatusOK, gin.H{"intent": "unknown", "reply": "未收到语音或文本内容。", "transcript": ""})
		return
	}

	intent := "question"
	if strings.Contains(transcript, "下一步") || strings.Contains(transcript, "继续") {
		intent = "NEXT_STEP"
	} else if strings.Contains(transcript, "上一步") {
		intent = "PREV_STEP"
	}

	system := cfg.SystemPrompt + "\n\n你正在做饭模式陪读助手中，根据用户语音回答问题，勿执行未经确认的写库操作。"
	messages := []ChatMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: "用户语音提问：" + transcript},
	}
	reply, err := ChatCompletion(ctx, cfg, messages, ChatOptions{Model: cfg.ChatModel})
	if err != nil {
		msg := fallbackChatReply(transcript)
		resp := gin.H{"intent": intent, "reply": msg, "transcript": transcript}
		if isNotConfigured(err) {
			resp["fallback"] = true
			resp["failureReason"] = errAINotConfigured
		} else {
			resp["failureReason"] = "AI_REQUEST_FAILED"
		}
		c.JSON(http.StatusOK, resp)
		return
	}
	c.JSON(http.StatusOK, gin.H{"intent": intent, "reply": reply, "transcript": transcript, "provider": providerName(cfg)})
}

func (h *Handlers) Transcribe(c *gin.Context) {
	cfg := LoadProviderConfig(h.DB)
	ctx := c.Request.Context()
	var body map[string]any
	_ = c.ShouldBindJSON(&body)

	var audioBytes []byte
	mimeType := "audio/m4a"
	if fh, err := c.FormFile("file"); err == nil && fh != nil {
		f, err := fh.Open()
		if err != nil {
			httpx.SendError(c, http.StatusBadRequest, "无法读取音频", "INVALID_BODY")
			return
		}
		defer f.Close()
		audioBytes, _ = readAllLimited(f, 25<<20)
		mimeType = fh.Header.Get("Content-Type")
	} else {
		audioBytes, mimeType = decodeAudioFromRequest(body, nil, "")
	}
	if len(audioBytes) == 0 {
		httpx.SendError(c, http.StatusBadRequest, "缺少音频数据", "INVALID_BODY")
		return
	}
	text, err := Transcribe(ctx, cfg.ForAsr(), audioBytes, mimeType, "")
	provider := providerName(cfg)
	if err != nil {
		if isNotConfigured(err) {
			c.JSON(http.StatusOK, gin.H{"text": "", "provider": provider, "fallback": true, "failureReason": errAINotConfigured})
			return
		}
		httpx.SendError(c, http.StatusBadGateway, "语音转写失败", "AI_REQUEST_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{"text": text, "provider": provider})
}

func (h *Handlers) WriteConfirmCommit(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	confirmationID := c.Param("confirmationId")
	var body struct {
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.IdempotencyKey) == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}

	express := writeConfirmExpressShape(h.DB)
	var status sql.NullString
	var resultJSON sql.NullString
	var q string
	if express {
		q = `SELECT status, COALESCE(committed_result_json,'') FROM ai_write_confirmations WHERE id=? AND user_id=?`
	} else {
		q = `SELECT status, COALESCE(result_json,'') FROM ai_write_confirmations WHERE id=? AND user_id=?`
	}
	err := h.DB.QueryRow(q, confirmationID, userID).Scan(&status, &resultJSON)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "确认记录不存在或无权访问", "WRITE_CONFIRMATION_NOT_FOUND")
		return
	}
	if status.String == "committed" && resultJSON.Valid && resultJSON.String != "" {
		var result any
		_ = json.Unmarshal([]byte(resultJSON.String), &result)
		c.JSON(http.StatusOK, gin.H{"success": true, "result": result})
		return
	}
	commitResult := map[string]any{"committed": true, "confirmationId": confirmationID}
	resultBytes, _ := json.Marshal(commitResult)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if express {
		res, execErr := h.DB.Exec(`UPDATE ai_write_confirmations SET status='committed', idempotency_key=?,
			committed_result_json=?, committed_at=?, updated_at=? WHERE id=? AND user_id=? AND status='preview'`,
			body.IdempotencyKey, string(resultBytes), now, now, confirmationID, userID)
		if execErr != nil {
			httpx.SendError(c, http.StatusInternalServerError, "确认操作失败", "WRITE_CONFIRMATION_FAILED")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			httpx.SendError(c, http.StatusConflict, "确认记录已失效或不可提交", "WRITE_CONFIRMATION_INVALID")
			return
		}
	} else {
		_, _ = h.DB.Exec(`UPDATE ai_write_confirmations SET status='committed', idempotency_key=?,
			result_json=?, updated_at=? WHERE id=? AND user_id=?`,
			body.IdempotencyKey, string(resultBytes), now, confirmationID, userID)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": commitResult})
}

func (h *Handlers) AgentRunGet(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	runID := c.Param("runId")
	run, ok := getAgentRun(h.DB, runID, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "Agent Run 不存在或无权访问", "AGENT_RUN_NOT_FOUND")
		return
	}
	afterSequence := 0
	if q := strings.TrimSpace(c.Query("afterSequence")); q != "" {
		afterSequence, _ = strconv.Atoi(q)
	}
	c.JSON(http.StatusOK, gin.H{
		"run":           run,
		"actions":       []any{},
		"events":        listAgentRunEvents(h.DB, runID, afterSequence),
		"solutionCards": []any{},
	})
}

func (h *Handlers) AgentRunMedia(c *gin.Context) {
	c.JSON(http.StatusOK, []any{})
}

func (h *Handlers) agentRunAction(c *gin.Context, status string) {
	userID, _ := expressauth.UserID(c)
	runID := c.Param("runId")
	if _, ok := getAgentRun(h.DB, runID, userID); !ok {
		httpx.SendError(c, http.StatusNotFound, "Agent Run 不存在或无权访问", "AGENT_RUN_NOT_FOUND")
		return
	}
	if status != "" {
		setAgentRunStatus(h.DB, runID, userID, status)
	}
	run, _ := getAgentRun(h.DB, runID, userID)
	c.JSON(http.StatusOK, gin.H{
		"success":         true,
		"mode":            "agent",
		"run":             run,
		"reply":           run["reply"],
		"artifacts":       run["artifacts"],
		"solutionCards":   []any{},
		"pendingApproval": nil,
	})
}

func (h *Handlers) AgentRunResume(c *gin.Context) {
	h.agentRunAction(c, "completed")
}

func (h *Handlers) AgentRunCancel(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	runID := c.Param("runId")
	if _, ok := getAgentRun(h.DB, runID, userID); !ok {
		httpx.SendError(c, http.StatusNotFound, "Agent Run 不存在或无权访问", "AGENT_RUN_NOT_FOUND")
		return
	}
	setAgentRunStatus(h.DB, runID, userID, "cancelled")
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handlers) AgentRunRetry(c *gin.Context) {
	h.agentRunAction(c, "completed")
}

func (h *Handlers) AgentRunUndo(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	runID := c.Param("runId")
	if _, ok := getAgentRun(h.DB, runID, userID); !ok {
		httpx.SendError(c, http.StatusNotFound, "Agent Run 不存在或无权访问", "AGENT_RUN_NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": map[string]any{}})
}

func (h *Handlers) RealtimeVoiceCreateSession(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID, expiresIn := h.voice.create(userID)
	c.JSON(http.StatusCreated, gin.H{"sessionId": sessionID, "expiresIn": expiresIn})
}

func (h *Handlers) RealtimeVoiceHeartbeat(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID := c.Param("sessionId")
	if _, ok := h.voice.get(sessionID, userID); !ok {
		httpx.SendError(c, http.StatusNotFound, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) RealtimeVoiceAudioChunk(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID := c.Param("sessionId")
	sess, ok := h.voice.get(sessionID, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND")
		return
	}
	sess.appendEvent("audio_chunk", map[string]any{"ok": true})
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) RealtimeVoiceTurn(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID := c.Param("sessionId")
	sess, ok := h.voice.get(sessionID, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND")
		return
	}
	var body map[string]any
	_ = c.ShouldBindJSON(&body)
	transcript := strings.TrimSpace(asStringField(body, "transcript", "text"))
	if transcript == "" {
		transcript = strings.TrimSpace(asStringField(body, "speechText"))
	}
	reply := "未收到语音或文本内容。"
	if transcript != "" {
		cfg := LoadProviderConfig(h.DB)
		system := cfg.SystemPrompt + "\n\n你正在做饭模式陪读助手中，根据用户语音回答问题，回答简洁。"
		messages := []ChatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: transcript},
		}
		text, err := ChatCompletion(c.Request.Context(), cfg, messages, ChatOptions{Model: cfg.ChatModel, MaxTokens: 512})
		if err != nil {
			reply = fallbackChatReply(transcript)
		} else {
			reply = text
		}
	}
	sess.appendEvent("turn", map[string]any{"reply": reply, "transcript": transcript})
	c.JSON(http.StatusOK, gin.H{"ok": true, "reply": reply, "transcript": transcript})
}

func (h *Handlers) RealtimeVoiceEvents(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID := c.Param("sessionId")
	sess, ok := h.voice.get(sessionID, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND")
		return
	}
	after := 0
	if q := strings.TrimSpace(c.Query("after")); q != "" {
		after, _ = strconv.Atoi(q)
	}
	c.JSON(http.StatusOK, gin.H{"events": voiceEventsJSON(sess.eventsAfter(after))})
}

func (h *Handlers) RealtimeVoiceStream(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID := c.Param("sessionId")
	sess, ok := h.voice.get(sessionID, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND")
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)
	after := 0
	if q := strings.TrimSpace(c.Query("after")); q != "" {
		after, _ = strconv.Atoi(q)
	}
	for _, ev := range sess.eventsAfter(after) {
		payload := marshalSSEData(ev.Payload)
		_, _ = c.Writer.Write([]byte("event: " + ev.Type + "\ndata: " + payload + "\n\n"))
	}
	doneData := marshalSSEData(map[string]any{"type": "done", "sessionId": sessionID})
	_, _ = c.Writer.Write([]byte("event: done\ndata: " + doneData + "\n\n"))
	if f, ok := c.Writer.(http.Flusher); ok {
		f.Flush()
	}
}

func (h *Handlers) RealtimeVoiceDeleteSession(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	sessionID := c.Param("sessionId")
	if !h.voice.delete(sessionID, userID) {
		httpx.SendError(c, http.StatusNotFound, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func nullStr(v sql.NullString) any {
	if !v.Valid {
		return nil
	}
	return v.String
}
