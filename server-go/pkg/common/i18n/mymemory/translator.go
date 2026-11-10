// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package mymemory implements the i18n.Translator interface using the
// MyMemory translation API (https://mymemory.translated.net/).
package mymemory

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Translator implements i18n.Translator via the MyMemory API.
type Translator struct {
	client    *http.Client
	baseURL   string
	email     string // optional, for higher rate limits
	userAgent string
}

// New creates a MyMemory translator. The email parameter is optional and
// increases the API rate limit when provided.
func New(email string) *Translator {
	return &Translator{
		client:    &http.Client{Timeout: 10 * time.Second},
		baseURL:   "https://api.mymemory.translated.net/get",
		email:     email,
		userAgent: "LingBase/1.0",
	}
}

type apiResponse struct {
	ResponseData struct {
		TranslatedText string  `json:"translatedText"`
		Match          float64 `json:"match"`
	} `json:"responseData"`
	QuotaFinished   bool   `json:"quotaFinished"`
	MTLangSupported bool   `json:"mtLangSupported"`
	ResponseDetails string `json:"responseDetails"`
	ResponseStatus  int    `json:"responseStatus"`
}

// Translate translates text from one language to another.
func (t *Translator) Translate(text, from, to string) (string, error) {
	if text == "" {
		return "", fmt.Errorf("text cannot be empty")
	}
	from = normalizeLangCode(from)
	to = normalizeLangCode(to)
	if from == to {
		return text, nil
	}

	params := url.Values{}
	params.Set("q", text)
	params.Set("langpair", fmt.Sprintf("%s|%s", from, to))
	if t.email != "" {
		params.Set("de", t.email)
	}

	reqURL := fmt.Sprintf("%s?%s", t.baseURL, params.Encode())
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", t.userAgent)

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	var apiResp apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if apiResp.ResponseStatus != 200 {
		return "", fmt.Errorf("API error: %s (status: %d)", apiResp.ResponseDetails, apiResp.ResponseStatus)
	}
	if apiResp.QuotaFinished {
		return "", fmt.Errorf("translation quota finished")
	}

	if apiResp.ResponseData.TranslatedText == "" {
		return text, nil
	}
	return apiResp.ResponseData.TranslatedText, nil
}

// TranslateBatch translates multiple texts sequentially with a small delay
// between requests to avoid rate limiting.
func (t *Translator) TranslateBatch(texts []string, from, to string) ([]string, error) {
	results := make([]string, len(texts))
	for i, text := range texts {
		translated, err := t.Translate(text, from, to)
		if err != nil {
			return nil, fmt.Errorf("failed to translate text at index %d: %w", i, err)
		}
		results[i] = translated
		time.Sleep(100 * time.Millisecond)
	}
	return results, nil
}

// normalizeLangCode normalises a language code to MyMemory's expected format.
func normalizeLangCode(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	langMap := map[string]string{
		"zh": "zh-CN", "zh-cn": "zh-CN", "zh-tw": "zh-TW", "zh-hk": "zh-TW",
		"en": "en", "en-us": "en", "en-gb": "en",
		"es": "es", "fr": "fr", "de": "de", "it": "it", "pt": "pt",
		"ru": "ru", "ja": "ja", "ko": "ko", "ar": "ar", "hi": "hi",
		"th": "th", "vi": "vi", "id": "id", "tr": "tr", "pl": "pl",
		"nl": "nl", "sv": "sv", "da": "da", "fi": "fi", "no": "no",
	}
	if v, ok := langMap[lang]; ok {
		return v
	}
	// Try the language part of a hyphenated code (e.g. "fr-fr" → "fr").
	if parts := strings.Split(lang, "-"); len(parts) > 0 {
		if v, ok := langMap[parts[0]]; ok {
			return v
		}
	}
	return lang
}

// SupportedLanguages returns the list of language codes supported by MyMemory.
func SupportedLanguages() []string {
	return []string{
		"en", "zh-CN", "zh-TW", "es", "fr", "de", "it", "pt", "ru",
		"ja", "ko", "ar", "hi", "th", "vi", "id", "tr", "pl", "nl",
		"sv", "da", "fi", "no",
	}
}
