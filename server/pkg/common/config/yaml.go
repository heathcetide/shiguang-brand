// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// loadYAML reads a YAML file and unmarshals it into out.
// out must be a pointer to a struct.
func loadYAML(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	if err := yaml.Unmarshal(data, out); err != nil {
		return fmt.Errorf("yaml unmarshal: %w", err)
	}
	return nil
}

// loadENVFile reads a .env file and optionally sets values into os.Environ.
// When overwriteEnv is true, values are written via os.Setenv, making them
// available to subsequent env var reads.
func loadENVFile(path string, overwriteEnv bool) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Handle "export KEY=value"
		if strings.HasPrefix(strings.ToLower(line), "export ") {
			line = strings.TrimSpace(line[len("export "):])
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := trimENVValue(strings.TrimSpace(parts[1]))
		if key == "" {
			continue
		}
		if overwriteEnv {
			os.Setenv(key, val)
		}
		// Store in the env store for struct tag application.
		envStore.Set(key, val)
	}
	return nil
}

// trimENVValue removes surrounding quotes and trailing inline comments.
func trimENVValue(v string) string {
	v = strings.TrimSpace(v)
	if v != "" && v[0] != '"' && v[0] != '\'' {
		// Strip inline comments (only when preceded by whitespace).
		for i := 0; i < len(v); i++ {
			if v[i] != '#' {
				continue
			}
			if i > 0 && (v[i-1] == ' ' || v[i-1] == '\t') {
				v = strings.TrimSpace(v[:i])
				break
			}
		}
	}
	// Remove surrounding quotes.
	if len(v) >= 2 {
		if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
			return strings.TrimSpace(v[1 : len(v)-1])
		}
	}
	return v
}
