package voicepacks_test

import (
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/voicepacks"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"testing"
)

func TestCatalogFingerprintAndVersion(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		before := voicepacks.CatalogVersion(db)
		manifest := map[string]any{"voiceId": "test", "version": "1.0.0"}
		fingerprint := voicepacks.ResourceFingerprint(manifest)
		testutil.Exec(t, db, `INSERT INTO voice_pack_versions(voice_id,name,version,manifest_json,resource_fingerprint,status) VALUES (?,?,?,?,?,'published')`, "test", "测试音色", "1.0.0", `{"voiceId":"test"}`, fingerprint)
		after := voicepacks.CatalogVersion(db)
		if before == after || after == "empty" || len(fingerprint) != 64 {
			t.Fatalf("catalog version did not change: %s -> %s", before, after)
		}
		testutil.Exec(t, db, `UPDATE voice_pack_versions SET revision=revision+1,status='revoked' WHERE voice_id=?`, "test")
		if voicepacks.CatalogVersion(db) == after {
			t.Fatal("revocation did not invalidate catalog version")
		}
	})
}
