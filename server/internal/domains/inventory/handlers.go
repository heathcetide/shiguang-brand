// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

type Handlers struct {
	Service *Service
	Auth    *expressauth.Auth
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {
	g := engine.Group("/api/v1/inventory")
	g.Use(h.Auth.Middleware())
	{
		g.GET("", h.List)
		g.POST("/import-shopping-list", h.ImportShoppingList)
		g.POST("/bulk-intake", h.BulkIntake)
		g.POST("/consumption-preview", h.ConsumptionPreview)
		g.POST("/consume", h.Consume)
		g.GET("/scan-jobs/:jobId/review", h.ReviewScan)
		g.POST("/scan-jobs/:jobId/accept", h.AcceptScan)
		g.POST("/scan-jobs/:jobId/undo", h.UndoScan)
		g.GET("/:id/evidence", h.Evidence)
		g.GET("/:id/history", h.History)
		g.POST("", h.Create)
		g.PUT("/:id", h.Update)
		g.DELETE("/:id", h.Remove)
	}
}

func (h *Handlers) List(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	items, err := h.Service.List(userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取库存失败", "INVENTORY_LIST_FAILED")
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handlers) Create(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	item, err := h.Service.Create(userID, body)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handlers) Update(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "无效的库存 ID", "INVALID_ID")
		return
	}
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	item, err := h.Service.Update(userID, id, body)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) ImportShoppingList(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.ImportShoppingList(userID, body)
	if err != nil {
		writeErr(c, err)
		return
	}
	if repeated, _ := result["repeated"].(bool); repeated {
		c.JSON(http.StatusOK, result)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) BulkIntake(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.BulkIntake(userID, body)
	if err != nil {
		writeErr(c, err)
		return
	}
	if repeated, _ := result["repeated"].(bool); repeated {
		c.JSON(http.StatusOK, result)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) ConsumptionPreview(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.ConsumptionPreview(userID, body)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) Consume(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.Consume(userID, body)
	if err != nil {
		writeErr(c, err)
		return
	}
	if repeated, _ := result["repeated"].(bool); repeated {
		c.JSON(http.StatusOK, result)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) ReviewScan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	result, err := h.Service.ReviewScan(userID, c.Param("jobId"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) AcceptScan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	result, err := h.Service.AcceptScan(userID, c.Param("jobId"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) UndoScan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	result, err := h.Service.UndoScan(userID, c.Param("jobId"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) Evidence(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "无效的库存 ID", "INVALID_ID")
		return
	}
	result, err := h.Service.Evidence(userID, id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) History(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "无效的库存 ID", "INVALID_ID")
		return
	}
	result, err := h.Service.History(userID, id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) Remove(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "无效的库存 ID", "INVALID_ID")
		return
	}
	result, err := h.Service.Remove(userID, id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func writeErr(c *gin.Context, err error) {
	if e, ok := err.(*APIError); ok {
		httpx.SendError(c, e.Status, e.Message, e.Code)
		return
	}
	httpx.SendError(c, http.StatusInternalServerError, "服务器内部错误", "INTERNAL_ERROR")
}
