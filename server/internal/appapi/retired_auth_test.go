package appapi_test

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/appapi"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestRetiredPhoneVerificationHasNoRoutesOrTables(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		router := gin.New()
		appapi.Register(router, appapi.Deps{DB: db, Auth: expressauth.New(testutil.Secret, db)})
		for _, path := range []string{
			"/api/v1/auth/sms/send", "/api/v1/auth/sms/verify", "/api/v1/auth/sms/register",
			"/api/v1/auth/phone-binding/send", "/api/v1/auth/phone-binding/verify",
			"/api/v1/auth/phone-binding/replace/send", "/api/v1/auth/phone-binding/replace/verify",
			"/api/v1/auth/reauth/sms/send", "/api/v1/auth/reauth/sms/verify",
			"/api/v1/auth/password-recovery/send", "/api/v1/auth/password-recovery/verify", "/api/v1/auth/password",
			"/api/v1/admin/auth-services/sms/config", "/api/v1/admin/auth-services/sms/overview", "/api/v1/admin/auth-services/sms/events",
			"/api/v1/admin/auth-services/sms/events/1/reveal-phone", "/api/v1/admin/auth-services/sms/test-send", "/api/v1/admin/auth-services/sms/package/reconcile",
			"/api/v1/webhooks/sms", "/api/v1/webhooks/aliyun/sms-delivery/retired",
		} {
			for _, method := range []string{"GET", "POST", "PUT"} {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(method, path, strings.NewReader(`{}`)))
				if response.Code != 404 {
					t.Fatalf("removed endpoint %s %s returned %d", method, path, response.Code)
				}
			}
		}
		for _, table := range []string{"sms_events", "sms_logs", "sms_auth_challenges", "sms_dev_outbox", "account_reauth_grants", "auth_verification_subjects", "auth_verification_challenges", "auth_verification_events", "auth_verification_usage_daily"} {
			if db.HasTable(table) {
				t.Fatalf("retired table still exists: %s", table)
			}
		}
		if !db.HasTable("users") || !db.HasTable("email_auth_challenges") {
			t.Fatal("retirement removed retained authentication data")
		}
	})
}
