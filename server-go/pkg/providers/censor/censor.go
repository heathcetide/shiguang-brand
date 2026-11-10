// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package censor provides shared types and interfaces for content moderation
// across multiple cloud providers.
//
// This core package has zero cloud SDK dependencies. Provider implementations
// live in separate modules (censor/qiniu, censor/aliyun, censor/qcloud) so
// that applications only import the SDK they actually use.
package censor

// Suggestion values returned by all providers.
const (
	SuggestionPass   = "pass"
	SuggestionReview = "review"
	SuggestionBlock  = "block"
)

// Moderation label values.
const (
	LabelNormal      = "normal"
	LabelSpam        = "spam"
	LabelAd          = "ad"
	LabelPolitics    = "politics"
	LabelTerrorism   = "terrorism"
	LabelAbuse       = "abuse"
	LabelPorn        = "porn"
	LabelFlood       = "flood"
	LabelContraband  = "contraband"
	LabelMeaningless = "meaningless"
)

// Async job status values.
const (
	JobWaiting  = "WAITING"
	JobDoing    = "DOING"
	JobFinished = "FINISHED"
	JobFailed   = "FAILED"
)

// CensorResult is the unified moderation result for synchronous checks
// (text, image). All providers normalize their response into this type.
type CensorResult struct {
	Suggestion string  `json:"suggestion"`        // pass, review, or block
	Label      string  `json:"label"`             // moderation label
	Score      float64 `json:"score"`             // confidence score (0.0 to 1.0)
	Details    string  `json:"details,omitempty"` // additional details
	Msg        string  `json:"msg"`               // human-readable message
}

// JobSnapshot is the normalized result for async moderation jobs (audio, video).
// Raw holds the original provider response for advanced inspection.
type JobSnapshot struct {
	Status     string  `json:"status"`               // WAITING | DOING | FINISHED | FAILED
	Suggestion string  `json:"suggestion,omitempty"` // pass | review | block (when FINISHED)
	Label      string  `json:"label,omitempty"`      // moderation label (when FINISHED)
	Score      float64 `json:"score,omitempty"`      // confidence score (when FINISHED)
	Msg        string  `json:"msg,omitempty"`        // provider message or audio transcript
	Error      string  `json:"error,omitempty"`      // error details (when FAILED)
	Raw        any     `json:"-"`                    // original provider response
}

// BuildCensorMsg returns a human-readable English message for a moderation label.
func BuildCensorMsg(label string) string {
	switch label {
	case LabelNormal:
		return "normal content"
	case LabelSpam:
		return "contains spam"
	case LabelAd:
		return "advertisement"
	case LabelPolitics:
		return "political content"
	case LabelTerrorism:
		return "terrorism content"
	case LabelAbuse:
		return "abusive content"
	case LabelPorn:
		return "pornographic content"
	case LabelFlood:
		return "flooding"
	case LabelContraband:
		return "contraband"
	case LabelMeaningless:
		return "meaningless content"
	default:
		if label == "" {
			return "normal content"
		}
		return "unknown label: " + label
	}
}
