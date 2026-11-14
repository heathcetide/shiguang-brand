// Copyright (c) 2026 heathcetide. All rights reserved.

package auth

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

// Handlers exposes Express-compatible /api/v1/auth routes.
type Handlers struct {
	Service *Service
	Auth    *expressauth.Auth
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {
	engine.POST("/api/v1/auth/register", h.RegisterUser)
	engine.POST("/api/v1/auth/login", h.Login)
	engine.POST("/api/v1/auth/password-recovery/reset", h.RecoveryReset)
	engine.POST("/api/v1/auth/email-recovery/send", h.EmailRecoverySend)
	engine.POST("/api/v1/auth/email-recovery/verify", h.EmailRecoveryVerify)

	secured := engine.Group("/api/v1/auth")
	secured.Use(h.Auth.Middleware())
	{
		secured.GET("/me", h.Me)
		secured.PUT("/profile", h.UpdateProfile)
		secured.POST("/change-password", h.ChangePassword)
		secured.GET("/ai-data", h.ExportAIData)
		secured.DELETE("/ai-data", h.DeleteAIData)
		secured.DELETE("/account", h.DeleteAccount)
		secured.POST("/email-verification/send", h.EmailVerificationSend)
		secured.POST("/email-verification/verify", h.EmailVerificationVerify)

	}
}

func (h *Handlers) RegisterUser(c *gin.Context) {
	var body struct {
		Identifier string `json:"identifier"`
		Username   string `json:"username"`
		Password   string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.Register(body.Identifier, body.Username, body.Password)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) Login(c *gin.Context) {
	var body struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.Login(body.Identifier, body.Password, c.ClientIP(), c.GetHeader("User-Agent"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) Me(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	result, err := h.Service.Me(userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) UpdateProfile(c *gin.Context) {
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
	result, err := h.Service.UpdateProfile(userID, body)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) ChangePassword(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.ChangePassword(userID, body.CurrentPassword, body.NewPassword)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) ExportAIData(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	result, err := h.Service.ExportAIData(userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) DeleteAIData(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	result, err := h.Service.DeleteAIData(userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) DeleteAccount(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		Password string `json:"password"`
	}
	_ = c.ShouldBindJSON(&body)
	result, err := h.Service.DeleteAccount(userID, body.Password)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) EmailVerificationSend(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		CurrentPassword string `json:"currentPassword"`
	}
	_ = c.ShouldBindJSON(&body)
	result, err := h.Service.SendEmailVerification(userID, body.CurrentPassword)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) EmailVerificationVerify(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		ChallengeID string `json:"challengeId"`
		Code        string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.VerifyEmailChallenge(body.ChallengeID, body.Code, "email_verify", &userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) EmailRecoverySend(c *gin.Context) {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.SendEmailRecovery(body.Email)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) EmailRecoveryVerify(c *gin.Context) {
	var body struct {
		ChallengeID string `json:"challengeId"`
		Code        string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.VerifyEmailChallenge(body.ChallengeID, body.Code, "email_recovery", nil)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) RecoveryReset(c *gin.Context) {
	var body struct {
		RecoveryToken string `json:"recoveryToken"`
		NewPassword   string `json:"newPassword"`
		Channel       string `json:"channel"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	if body.Channel == "" {
		body.Channel = "email"
	}
	if body.Channel != "email" {
		httpx.SendError(c, http.StatusBadRequest, "仅支持邮箱找回密码", "INVALID_RECOVERY_CHANNEL")
		return
	}
	result, err := h.Service.RecoverPassword(body.RecoveryToken, body.NewPassword, body.Channel)
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
