/*
Copyright (C) 2023-2026 LingByte

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@lingbyte.com
*/
package dto

// ModerationRequest is the OpenAI-compatible /v1/moderations body.
type ModerationRequest struct {
	Model string `json:"model,omitempty"`
	Input any    `json:"input"` // string | []string
}

// ModerationResponse is the unified moderations payload returned to clients.
// OpenAI upstream results and local pkg/censor results are both normalized here.
type ModerationResponse struct {
	ID      string              `json:"id"`
	Model   string              `json:"model"`
	Results []ModerationResult  `json:"results"`
}

// ModerationResult unifies OpenAI categories with censor suggestion/label fields.
type ModerationResult struct {
	Flagged                   bool               `json:"flagged"`
	Categories                map[string]bool    `json:"categories"`
	CategoryScores            map[string]float64 `json:"category_scores"`
	CategoryAppliedInputTypes map[string][]string `json:"category_applied_input_types,omitempty"`
	// Censor-compatible extensions (always present for local censor; optional for OpenAI).
	Suggestion string  `json:"suggestion,omitempty"` // pass | review | block
	Label      string  `json:"label,omitempty"`
	Score      float64 `json:"score,omitempty"`
	Details    string  `json:"details,omitempty"`
	Msg        string  `json:"msg,omitempty"`
}
