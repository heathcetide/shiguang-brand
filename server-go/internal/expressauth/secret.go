// Copyright (c) 2026 heathcetide. All rights reserved.

package expressauth

import (
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
)

// LoadJWTSecret mirrors server/src/config/security.ts.
func LoadJWTSecret() (string, error) {
	if v := strings.TrimSpace(os.Getenv("JWT_SECRET")); v != "" {
		if len(v) < 32 {
			return "", errProductionSecret
		}
		return v, nil
	}
	if strings.EqualFold(os.Getenv("NODE_ENV"), "production") || strings.EqualFold(os.Getenv("APP_APP_ENVIRONMENT"), "prod") {
		return "", errProductionSecret
	}
	candidates := []string{
		filepath.Join("..", "server", "data", "jwt_secret.key"),
		filepath.Join("server", "data", "jwt_secret.key"),
		filepath.Join("data", "jwt_secret.key"),
	}
	for _, path := range candidates {
		abs, err := filepath.Abs(path)
		if err != nil {
			continue
		}
		raw, err := os.ReadFile(abs)
		if err != nil {
			continue
		}
		secret := strings.TrimSpace(string(raw))
		if len(secret) >= 32 {
			return secret, nil
		}
	}

	// Dev fallback matching Express behavior when file creation fails.
	fallback := "dietdigidose_persistent_dev_jwt_secret_key_32bytes_min"
	if strings.EqualFold(os.Getenv("NODE_ENV"), "production") || strings.EqualFold(os.Getenv("APP_APP_ENVIRONMENT"), "prod") {
		return "", errProductionSecret
	}

	// Try to create Express-compatible secret file next to Express DB.
	dir := filepath.Join("..", "server", "data")
	if abs, err := filepath.Abs(dir); err == nil {
		_ = os.MkdirAll(abs, 0o755)
		path := filepath.Join(abs, "jwt_secret.key")
		if _, err := os.Stat(path); os.IsNotExist(err) {
			buf := make([]byte, 48)
			if _, err := rand.Read(buf); err == nil {
				secret := base64.RawURLEncoding.EncodeToString(buf)
				_ = os.WriteFile(path, []byte(secret), 0o600)
				return secret, nil
			}
		}
	}
	return fallback, nil
}

var errProductionSecret = errString("生产环境必须设置长度至少为 32 个字符的 JWT_SECRET")

type errString string

func (e errString) Error() string { return string(e) }
