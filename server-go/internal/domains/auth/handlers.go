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

	// SMS auth under /api/v1/auth/sms (Express auth-sms mount)
	engine.POST("/api/v1/auth/sms/send", h.SMSSend)
	engine.POST("/api/v1/auth/sms/verify", h.SMSVerify)
	engine.POST("/api/v1/auth/sms/register", h.SMSRegister)

	engine.POST("/api/v1/auth/password-recovery/send", h.PasswordRecoverySend)
	engine.POST("/api/v1/auth/password-recovery/verify", h.PasswordRecoveryVerify)

	secured := engine.Group("/api/v1/auth")
	secured.Use(h.Auth.Middleware())
	{
		secured.GET("/me", h.Me)
		secured.PUT("/profile", h.UpdateProfile)
		secured.POST("/change-password", h.ChangePassword)
		secured.POST("/password", h.SetPassword)
		secured.GET("/ai-data", h.ExportAIData)
		secured.DELETE("/ai-data", h.DeleteAIData)
		secured.DELETE("/account", h.DeleteAccount)
		secured.POST("/email-verification/send", h.EmailVerificationSend)
		secured.POST("/email-verification/verify", h.EmailVerificationVerify)

		secured.POST("/phone-binding/send", h.PhoneBindingSend)
		secured.POST("/phone-binding/verify", h.PhoneBindingVerify)
		secured.POST("/phone-binding/replace/send", h.PhoneReplaceSend)
		secured.POST("/phone-binding/replace/verify", h.PhoneReplaceVerify)

		secured.POST("/reauth/sms/send", h.ReauthSMSSend)
		secured.POST("/reauth/sms/verify", h.ReauthSMSVerify)
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

func (h *Handlers) SetPassword(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		NewPassword string `json:"newPassword"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.SetPassword(userID, body.NewPassword)
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
		body.Channel = "sms"
	}
	result, err := h.Service.RecoverPassword(body.RecoveryToken, body.NewPassword, body.Channel)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) SMSSend(c *gin.Context) {
	var body struct {
		Phone string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.SMSSend(body.Phone, smsPurposeLogin, nil)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) SMSVerify(c *gin.Context) {
	var body struct {
		ChallengeID string `json:"challengeId"`
		Code        string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.SMSVerify(body.ChallengeID, body.Code, smsPurposeLogin, nil)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) SMSRegister(c *gin.Context) {
	var body struct {
		RegistrationToken string `json:"registrationToken"`
		Username          string `json:"username"`
		Password          string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.SMSRegister(body.RegistrationToken, body.Username, body.Password)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) PasswordRecoverySend(c *gin.Context) {
	var body struct {
		Phone string `json:"phone"`
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	if body.Email != "" {
		httpx.SendError(c, http.StatusBadRequest, "当前暂不支持邮箱自助找回，请使用已绑定的手机号或联系管理员人工恢复", "EMAIL_RECOVERY_UNSUPPORTED")
		return
	}
	phone := body.Phone
	if phone == "" {
		phone = body.Email
	}
	result, err := h.Service.PasswordRecoverySMSSend(phone)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) PasswordRecoveryVerify(c *gin.Context) {
	var body struct {
		ChallengeID string `json:"challengeId"`
		Code        string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.PasswordRecoverySMSVerify(body.ChallengeID, body.Code)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) PhoneBindingSend(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		Phone           string `json:"phone"`
		CurrentPassword string `json:"currentPassword"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.PhoneBindingSend(userID, body.Phone, body.CurrentPassword)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) PhoneBindingVerify(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		ChallengeID string `json:"challengeId"`
		Code        string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.PhoneBindingVerify(userID, body.ChallengeID, body.Code)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) PhoneReplaceSend(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		NewPhone        string `json:"newPhone"`
		CurrentPassword string `json:"currentPassword"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.PhoneReplaceSend(userID, body.NewPhone, body.CurrentPassword)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) PhoneReplaceVerify(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		ChallengeID string `json:"challengeId"`
		Code        string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.PhoneReplaceVerify(userID, body.ChallengeID, body.Code)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handlers) ReauthSMSSend(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		Purpose string `json:"purpose"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.ReauthSMSSend(userID, body.Purpose)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handlers) ReauthSMSVerify(c *gin.Context) {
	userID, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}
	var body struct {
		Purpose     string `json:"purpose"`
		ChallengeID string `json:"challengeId"`
		Code        string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, err := h.Service.ReauthSMSVerify(userID, body.Purpose, body.ChallengeID, body.Code)
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
