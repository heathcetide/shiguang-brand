// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package probe

import (
	"context"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"time"
)

// ──────────────────────────────────────────────
// Sequence
// ──────────────────────────────────────────────

// SequenceStep is a single step in a multi-step probe sequence.
type SequenceStep struct {
	// Name is a human-readable step name.
	Name string

	// Request is the probe request for this step.
	Request Request

	// ExtractVars maps JSON paths to variable names.
	// Extracted values are stored in the sequence's variable map
	// and can be referenced by subsequent steps via "$${varName}".
	//
	// Example: map[string]string{"token": "data.access_token"}
	// → extracts data.access_token from response body, stores as "token".
	ExtractVars map[string]string
}

// SequenceResult holds the outcome of a sequence execution.
type SequenceResult struct {
	// Success is true only if all steps succeeded.
	Success bool

	// Steps holds per-step results.
	Steps []StepResult

	// Duration is the total sequence execution time.
	Duration time.Duration

	// Error is the first error encountered (empty on success).
	Error string

	// Variables holds all extracted variables.
	Variables map[string]string

	// Timestamp is when the sequence started.
	Timestamp time.Time
}

// StepResult holds the result of a single step within a sequence.
type StepResult struct {
	// Name is the step name.
	Name string

	// Result is the underlying probe result.
	Result

	// Skipped is true if this step was skipped due to a prior failure.
	Skipped bool
}

// Sequence runs a series of HTTP probes with variable pass-through
// and cookie continuity. If any step fails, subsequent steps are
// skipped (but still recorded as Skipped).
type Sequence struct {
	prober  *Prober
	steps   []SequenceStep
	vars    map[string]string
	cookies http.CookieJar
}

// NewSequence creates a sequence runner. If prober is nil, a default
// [Prober] is created.
func NewSequence(prober *Prober, steps []SequenceStep) *Sequence {
	if prober == nil {
		prober = New()
	}
	jar, _ := cookiejar.New(nil)
	return &Sequence{
		prober:  prober,
		steps:   steps,
		vars:    make(map[string]string),
		cookies: jar,
	}
}

// Execute runs all steps in sequence.
func (s *Sequence) Execute(ctx context.Context) SequenceResult {
	result := SequenceResult{
		Timestamp: time.Now(),
		Variables: make(map[string]string),
		Steps:     make([]StepResult, 0, len(s.steps)),
	}
	start := time.Now()
	defer func() { result.Duration = time.Since(start) }()

	failed := false
	for _, step := range s.steps {
		if failed {
			result.Steps = append(result.Steps, StepResult{
				Name:    step.Name,
				Skipped: true,
			})
			continue
		}

		// Inject current variables into the step request.
		if step.Request.Variables == nil {
			step.Request.Variables = make(map[string]string)
		}
		for k, v := range s.vars {
			if _, exists := step.Request.Variables[k]; !exists {
				step.Request.Variables[k] = v
			}
		}

		// Execute the probe.
		// We need to use a client that shares cookies across steps.
		stepResult := s.prober.Execute(ctx, step.Request)
		sr := StepResult{
			Name:   step.Name,
			Result: stepResult,
		}
		result.Steps = append(result.Steps, sr)

		if !stepResult.Success {
			failed = true
			result.Error = fmt.Sprintf("step %q: %s", step.Name, stepResult.Error)
			continue
		}

		// Extract variables from the response body.
		if len(step.ExtractVars) > 0 && stepResult.Body != "" {
			for varName, jsonPath := range step.ExtractVars {
				val, err := extractJSONPath([]byte(stepResult.Body), jsonPath)
				if err != nil {
					// Non-fatal: variable extraction failure doesn't fail the step.
					continue
				}
				s.vars[varName] = val
				result.Variables[varName] = val
			}
		}

		// Also capture any extracted values from Expect.BodyJSONPath.
		for k, v := range stepResult.Extracted {
			s.vars[k] = v
			result.Variables[k] = v
		}
	}

	result.Success = !failed
	return result
}

// Variables returns the current variable map (read-only).
func (s *Sequence) Variables() map[string]string {
	return s.vars
}
