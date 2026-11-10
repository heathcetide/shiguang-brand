// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package compat

import "strings"

// RegisterModelContextWindow registers a model's context window size.
func RegisterModelContextWindow(modelName string, contextWindowSize int) {
	ModelMutex.Lock()
	defer ModelMutex.Unlock()
	ModelContextWindows[strings.ToLower(modelName)] = contextWindowSize
}

// RegisterModelContextWindows registers multiple models' context window sizes in batch.
func RegisterModelContextWindows(models map[string]int) {
	ModelMutex.Lock()
	defer ModelMutex.Unlock()
	for modelName, contextWindowSize := range models {
		ModelContextWindows[strings.ToLower(modelName)] = contextWindowSize
	}
}

// LookupModelContextWindow returns a known context window size for the
// given model name. It returns ok=false when the model is unknown.
func LookupModelContextWindow(modelName string) (int, bool) {
	return LookupContextWindow(modelName)
}
