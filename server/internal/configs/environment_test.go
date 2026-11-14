package configs

import "testing"

func TestSharedDatabaseEnvironmentAndPrecedence(t *testing.T) {
	t.Setenv("NODE_ENV", "")
	t.Setenv("APP_APP_ENVIRONMENT", "")
	for _, tc := range []struct{ name, driver, url, path, appDriver, appDSN, wantDriver, wantDSN string }{
		{"postgres alias", "postgres", "postgresql://test.invalid/unused", "", "", "", "postgresql", "postgresql://test.invalid/unused"},
		{"sqlite path", "sqlite", "", "/tmp/unused-test.db", "", "", "sqlite", "/tmp/unused-test.db"},
		{"APP wins", "postgresql", "postgresql://test.invalid/unused", "", "sqlite", "explicit.db", "sqlite", "explicit.db"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DATABASE_DRIVER", tc.driver)
			t.Setenv("DATABASE_URL", tc.url)
			t.Setenv("DATABASE_PATH", tc.path)
			t.Setenv("APP_DATABASE_DRIVER", tc.appDriver)
			t.Setenv("APP_DATABASE_DSN", tc.appDSN)
			cfg, err := Load("/nonexistent-config")
			if err != nil {
				t.Fatal(err)
			}
			if cfg.Database.Driver != tc.wantDriver || cfg.Database.DSN != tc.wantDSN || cfg.Deployment.DatabaseDriver != tc.wantDriver {
				t.Fatalf("database config/health metadata mismatch: %+v", cfg.Database)
			}
		})
	}
}
func TestMissingConfigStillValidatesProductionSettings(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("APP_APP_ENVIRONMENT", "")
	t.Setenv("APP_DATABASE_DSN", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("DATABASE_PATH", "")
	if _, err := Load("/missing-production-config"); err == nil {
		t.Fatal("production silently accepted an implicit local database")
	}
}
