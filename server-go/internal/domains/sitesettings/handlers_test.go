package sitesettings_test

import (
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/sitesettings"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"testing"
)

func TestPublicFilingExcludesSecrets(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		for k, v := range map[string]string{"SITE_FILING_ENABLED": "true", "SITE_FILING_TEXT": "测试备案", "SITE_FILING_URL": "https://example.test/filing", "AI_API_KEY": "must-not-leak"} {
			testutil.Exec(t, db, `INSERT INTO system_settings(key,value) VALUES (?,?)`, k, v)
		}
		r := testutil.Router()
		(&sitesettings.Handlers{DB: db}).RegisterOn(r)
		result := testutil.Request(t, r, "GET", "/api/v1/site-settings", "", nil, 200).(map[string]any)
		filing := result["filing"].(map[string]any)
		if filing["enabled"] != true || filing["text"] != "测试备案" || len(result) != 1 {
			t.Fatalf("public filing contract: %v", result)
		}
	})
}
