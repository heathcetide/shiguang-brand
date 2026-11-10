// Copyright (c) 2026 heathcetide. All rights reserved.

package expressauth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadJWTSecretFromEnv(t *testing.T) {
	t.Setenv("JWT_SECRET", "abcdefghijklmnopqrstuvwxyz012345")
	secret, err := LoadJWTSecret()
	if err != nil {
		t.Fatal(err)
	}
	if secret != "abcdefghijklmnopqrstuvwxyz012345" {
		t.Fatalf("secret=%q", secret)
	}
}

func TestLoadJWTSecretFromFile(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	dir := t.TempDir()
	path := filepath.Join(dir, "jwt_secret.key")
	if err := os.WriteFile(path, []byte("file-secret-must-be-at-least-32-chars!!"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Point relative candidate by chdir into a fake server-go with sibling server/data.
	root := t.TempDir()
	serverData := filepath.Join(root, "server", "data")
	if err := os.MkdirAll(serverData, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(serverData, "jwt_secret.key"), []byte("file-secret-must-be-at-least-32-chars!!"), 0o600); err != nil {
		t.Fatal(err)
	}
	goDir := filepath.Join(root, "server-go")
	if err := os.MkdirAll(goDir, 0o755); err != nil {
		t.Fatal(err)
	}
	cwd, _ := os.Getwd()
	defer os.Chdir(cwd)
	if err := os.Chdir(goDir); err != nil {
		t.Fatal(err)
	}
	secret, err := LoadJWTSecret()
	if err != nil {
		t.Fatal(err)
	}
	if secret != "file-secret-must-be-at-least-32-chars!!" {
		t.Fatalf("secret=%q", secret)
	}
}
