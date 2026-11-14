// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package setting provides minimal configuration stubs for relay providers.
// In LingRein, these are backed by a database-backed settings system.
// In library mode, they return sensible defaults that can be overridden
// by the consuming application.
package setting

// GlobalSettings holds global relay settings. All fields default to false/empty.
type GlobalSettings struct {
	PassThroughRequestEnabled bool
}

var globalSettings = &GlobalSettings{}

// GetGlobalSettings returns the global settings instance.
func GetGlobalSettings() *GlobalSettings {
	return globalSettings
}

// SetGlobalSettings replaces the global settings.
func SetGlobalSettings(s *GlobalSettings) {
	if s != nil {
		globalSettings = s
	}
}

// ── Model settings ───────────────────────────────────────────────

// ModelSetting holds model-specific settings.
type ModelSetting struct {
	ThinkingAdapterEnabled             bool
	ThinkingAdapterBudgetTokensPercentage float64
}

var modelSetting = &ModelSetting{}

// GetModelSetting returns the model settings instance.
func GetModelSetting() *ModelSetting {
	return modelSetting
}

// ShouldPreserveThinkingSuffix reports whether a model's thinking suffix
// should be preserved. In library mode, defaults to false.
func ShouldPreserveThinkingSuffix(modelName string) bool {
	return false
}

// IsSyncImageModel reports whether a model supports synchronous image generation.
// Defaults to false.
func IsSyncImageModel(modelName string) bool {
	return false
}

// ── Gemini settings ──────────────────────────────────────────────

// GeminiSetting holds Gemini-specific settings.
type GeminiSetting struct {
	ThinkingAdapterEnabled             bool
	ThinkingAdapterBudgetTokensPercentage float64
	RemoveFunctionResponseIdEnabled    bool
}

var geminiSetting = &GeminiSetting{}

// GetGeminiSettings returns the Gemini settings instance.
func GetGeminiSettings() *GeminiSetting {
	return geminiSetting
}

// GetGeminiVersionSetting returns the API version for a Gemini model.
// Defaults to "v1beta".
func GetGeminiVersionSetting(modelName string) string {
	return "v1beta"
}

// ── Ratio settings (stubs) ───────────────────────────────────────

// WithCompactModelVariants returns the base model list for compact mode.
// In library mode, returns the input unchanged.
func WithCompactModelVariants(baseModelList []string) []string {
	return baseModelList
}

// WithCompactModelSuffix returns a model name with a compact suffix.
// In library mode, returns the input unchanged.
func WithCompactModelSuffix(suffix string) string {
	return suffix
}
