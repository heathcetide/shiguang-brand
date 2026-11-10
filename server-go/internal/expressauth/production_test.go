package expressauth

import "testing"

func TestProductionSecretFailsClosed(t *testing.T) {
	t.Setenv("APP_APP_ENVIRONMENT", "prod")
	for _, secret := range []string{"", "short-explicit-secret"} {
		t.Setenv("JWT_SECRET", secret)
		if _, err := LoadJWTSecret(); err == nil {
			t.Fatal("missing/short production secret accepted")
		}
	}
}
