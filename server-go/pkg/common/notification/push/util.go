// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"fmt"
	"os"
)

// stringFromCfg reads a string value from a ProviderConfig.
func stringFromCfg(cfg ProviderConfig, key string) string {
	if cfg == nil {
		return ""
	}
	v, ok := cfg[key]
	if !ok {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

// boolFromCfg reads a bool value from a ProviderConfig using toBool.
func boolFromCfg(cfg ProviderConfig, key string) bool {
	if cfg == nil {
		return false
	}
	v, ok := cfg[key]
	if !ok {
		return false
	}
	b, _ := toBool(v)
	return b
}

// intFromCfg reads an int value from a ProviderConfig.
func intFromCfg(cfg ProviderConfig, key string) int {
	if cfg == nil {
		return 0
	}
	v, ok := cfg[key]
	if !ok {
		return 0
	}
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	}
	return 0
}

// readFileBytes reads the entire file at path.
func readFileBytes(path string) ([]byte, error) {
	return os.ReadFile(path)
}
