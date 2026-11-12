// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestProviderConfigWithOverridesPrefersDraftValues(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		testutil.Exec(t, db, `INSERT INTO system_settings(key, value) VALUES ('AI_API_KEY', 'published-key')
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
		testutil.Exec(t, db, `INSERT INTO system_settings(key, value) VALUES ('AI_CHAT_MODEL', 'published-model')
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
		testutil.Exec(t, db, `INSERT INTO system_settings(key, value) VALUES ('AI_BASE_URL', 'https://published.example/v1')
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`)

		published := LoadProviderConfig(db)
		if published.APIKey != "published-key" || published.ChatModel != "published-model" {
			t.Fatalf("published config unexpected: %+v", published)
		}

		draft := ProviderConfigWithOverrides(db, map[string]string{
			"AI_API_KEY":    "draft-key",
			"AI_CHAT_MODEL": "draft-model",
			"AI_BASE_URL":   "https://draft.example/v1",
		})
		if draft.APIKey != "draft-key" || draft.ChatModel != "draft-model" || draft.BaseURL != "https://draft.example/v1" {
			t.Fatalf("draft overrides not applied: %+v", draft)
		}
	})
}
