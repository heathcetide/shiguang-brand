package ops_test

import (
	"github.com/heathcetide/DietDigiDose/internal/domains/ops"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"os"
	"path/filepath"
	"testing"
)

func TestUpdatesManifestAndUnavailable(t *testing.T) {
	r := testutil.Router()
	(&ops.Handlers{}).RegisterOn(r)
	t.Setenv("APP_UPDATE_MANIFEST_PATH", "")
	testutil.Request(t, r, "GET", "/api/v1/app-updates", "", nil, 503)
	path := filepath.Join(t.TempDir(), "updates.json")
	if err := os.WriteFile(path, []byte(`{"releases":[{"applicationId":"test.app","channel":"preview","buildNumber":10}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_UPDATE_MANIFEST_PATH", path)
	newer := testutil.Request(t, r, "GET", "/api/v1/app-updates?applicationId=test.app&channel=preview&buildNumber=9", "", nil, 200).(map[string]any)
	if newer["update"] == nil {
		t.Fatal("new release missing")
	}
	for _, query := range []string{"applicationId=test.app&channel=preview&buildNumber=10", "applicationId=other&channel=preview&buildNumber=1"} {
		res := testutil.Request(t, r, "GET", "/api/v1/app-updates?"+query, "", nil, 200).(map[string]any)
		if res["update"] != nil {
			t.Fatalf("unrelated/current update returned: %v", res)
		}
	}
}
