// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

const smsConfigKey = "auth.sms.config"

func (h *Handlers) SMSConfigGet(c *gin.Context) {
	v, ok := h.getSetting(smsConfigKey)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"config": map[string]any{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": parseJSONMap(v)})
}

func (h *Handlers) SMSConfigPut(c *gin.Context) {
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	raw, _ := json.Marshal(body)
	h.upsertSetting(smsConfigKey, string(raw))
	h.recordAudit(c, "sms.config.update", "auth_sms", "config", "更新短信服务配置")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) SMSTestSend(c *gin.Context) {
	h.recordAudit(c, "sms.test_send", "auth_sms", "test", "测试短信发送")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) SMSOverview(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"overview": map[string]any{}})
}

func (h *Handlers) SMSEvents(c *gin.Context) {
	if !h.hasTable("sms_events") {
		c.JSON(http.StatusOK, gin.H{"events": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT id, event_type, COALESCE(created_at,'') FROM sms_events ORDER BY id DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"events": []any{}})
		return
	}
	defer rows.Close()
	events := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var eventType, created string
		if err := rows.Scan(&id, &eventType, &created); err != nil {
			continue
		}
		events = append(events, map[string]any{"id": id, "eventType": eventType, "createdAt": created})
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (h *Handlers) SMSRevealPhone(c *gin.Context) {
	id := c.Param("id")
	phone := ""
	if h.hasTable("sms_events") && h.hasColumn("sms_events", "phone") {
		_ = h.DB.QueryRow(`SELECT COALESCE(phone,'') FROM sms_events WHERE id=?`, id).Scan(&phone)
	}
	h.recordAudit(c, "sms.reveal_phone", "sms_event", id, "Reveal phone")
	c.JSON(http.StatusOK, gin.H{"phone": phone})
}

func (h *Handlers) SMSPackageReconcile(c *gin.Context) {
	h.recordAudit(c, "sms.package.reconcile", "auth_sms", "package", "短信包对账")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
