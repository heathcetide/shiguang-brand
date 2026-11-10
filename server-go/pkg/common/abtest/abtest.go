// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package abtest provides deterministic A/B test (experiment) bucketing.
//
// A user is assigned to a variant of an experiment using a consistent hash of
// (userID, experimentName) so that the same user always lands in the same
// variant. Variant selection is weighted: a variant with weight 3 is three
// times as likely to be chosen as one with weight 1.
//
// # Quick start
//
//	a := abtest.NewAssigner()
//	a.AddExperiment(&abtest.Experiment{
//	    Name: "button-color",
//	    Variants: []abtest.Variant{
//	        {Name: "red", Weight: 1},
//	        {Name: "blue", Weight: 1},
//	    },
//	})
//	a.Assign("user-123") // map[string]string{"button-color": "blue"}
//	a.AssignOne("button-color", "user-123") // "blue"
package abtest

import (
	"errors"
	"fmt"
	"hash/fnv"
)

// Variant describes a single arm of an experiment.
type Variant struct {
	Name   string
	Weight int
}

// Experiment groups a set of weighted variants under a name.
type Experiment struct {
	Name     string
	Variants []Variant
}

// Assigner routes users to experiment variants using consistent hashing.
type Assigner struct {
	experiments map[string]*Experiment
}

// NewAssigner returns an empty Assigner.
func NewAssigner() *Assigner {
	return &Assigner{experiments: make(map[string]*Experiment)}
}

// AddExperiment registers an experiment. If an experiment with the same name
// already exists it is replaced.
func (a *Assigner) AddExperiment(exp *Experiment) {
	if exp == nil {
		return
	}
	a.experiments[exp.Name] = exp
}

// Assign returns the chosen variant name for every registered experiment.
func (a *Assigner) Assign(userID string) map[string]string {
	result := make(map[string]string, len(a.experiments))
	for name, exp := range a.experiments {
		result[name] = pickVariant(exp, HashPercentage(userID, name))
	}
	return result
}

// AssignOne returns the chosen variant name for a single experiment.
func (a *Assigner) AssignOne(expName, userID string) (string, error) {
	exp, ok := a.experiments[expName]
	if !ok {
		return "", fmt.Errorf("abtest: experiment %q not found: %w", expName, ErrExperimentNotFound)
	}
	return pickVariant(exp, HashPercentage(userID, expName)), nil
}

// pickVariant selects a variant given a hash percentage in [0,1).
func pickVariant(exp *Experiment, pct float64) string {
	total := 0
	for _, v := range exp.Variants {
		if v.Weight > 0 {
			total += v.Weight
		}
	}
	if total == 0 || len(exp.Variants) == 0 {
		return ""
	}
	target := pct * float64(total)
	cum := 0.0
	for _, v := range exp.Variants {
		if v.Weight <= 0 {
			continue
		}
		cum += float64(v.Weight)
		if target < cum {
			return v.Name
		}
	}
	// Fallback (should not happen): return the last valid variant.
	for i := len(exp.Variants) - 1; i >= 0; i-- {
		if exp.Variants[i].Weight > 0 {
			return exp.Variants[i].Name
		}
	}
	return ""
}

// HashPercentage returns a deterministic float64 in [0,1) derived from the
// FNV-1a hash of userID + ":" + experimentName.
func HashPercentage(userID, experimentName string) float64 {
	h := fnv.New64a()
	h.Write([]byte(userID))
	h.Write([]byte(":"))
	h.Write([]byte(experimentName))
	// Use the top 53 bits so the value fits in a float64 without precision loss.
	v := h.Sum64() >> (64 - 53)
	return float64(v) / float64(uint64(1)<<53)
}

// ErrExperimentNotFound is returned when an experiment name is not registered.
var ErrExperimentNotFound = errors.New("abtest: experiment not found")
