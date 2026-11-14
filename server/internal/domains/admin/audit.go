// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
)

func (h *Handlers) recordAudit(c *gin.Context, action, resourceType, resourceID, summary string) {
	adminID, ok := expressauth.UserID(c)
	if !ok {
		return
	}
	ip := c.ClientIP()
	ua := c.GetHeader("User-Agent")
	if h.hasColumn("admin_audit_logs", "details_json") {
		_, _ = h.DB.Exec(`INSERT INTO admin_audit_logs (admin_user_id,action,resource_type,resource_id,summary,details_json,ip_address,user_agent)
			VALUES (?,?,?,?,?,NULL,?,?)`, adminID, action, resourceType, resourceID, summary, ip, ua)
		return
	}
	_, _ = h.DB.Exec(`INSERT INTO admin_audit_logs (admin_user_id,action,resource_type,resource_id,summary,ip_address,user_agent)
		VALUES (?,?,?,?,?,?,?)`, adminID, action, resourceType, resourceID, summary, ip, ua)
}
