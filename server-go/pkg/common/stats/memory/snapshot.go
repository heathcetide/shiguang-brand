// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package memory

import "github.com/axiomhq/hyperloglog"

// Snapshot is a serializable representation of the in-memory collector's state.
// It can be used with gob/json for file persistence.
type Snapshot struct {
	Counters map[string]int64    `json:"counters"`
	Gauges   map[string]int64    `json:"gauges"`
	Sets     map[string][]string `json:"sets"`
	HLLs     map[string][]byte   `json:"hlls"`
	Timers   map[string][]int64  `json:"timers"`
}

// Snapshot takes a consistent snapshot of all primitives.
func (c *Collector) Snapshot() *Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()

	snap := &Snapshot{
		Counters: make(map[string]int64, len(c.counters)),
		Gauges:   make(map[string]int64, len(c.gauges)),
		Sets:     make(map[string][]string, len(c.sets)),
		HLLs:     make(map[string][]byte, len(c.hlls)),
		Timers:   make(map[string][]int64, len(c.timers)),
	}

	for k, ctr := range c.counters {
		ctr.mu.RLock()
		snap.Counters[k] = ctr.value
		ctr.mu.RUnlock()
	}
	for k, g := range c.gauges {
		g.mu.RLock()
		snap.Gauges[k] = g.value
		g.mu.RUnlock()
	}
	for k, s := range c.sets {
		s.mu.RLock()
		members := make([]string, 0, len(s.members))
		for m := range s.members {
			members = append(members, m)
		}
		snap.Sets[k] = members
		s.mu.RUnlock()
	}
	for k, h := range c.hlls {
		h.mu.RLock()
		data, err := h.sketch.MarshalBinary()
		if err == nil {
			snap.HLLs[k] = data
		}
		h.mu.RUnlock()
	}
	for k, t := range c.timers {
		t.mu.RLock()
		samples := make([]int64, len(t.samples))
		copy(samples, t.samples)
		snap.Timers[k] = samples
		t.mu.RUnlock()
	}
	return snap
}

// Restore loads state from a snapshot (replaces existing data).
func (c *Collector) Restore(snap *Snapshot) {
	if snap == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	c.counters = make(map[string]*counter, len(snap.Counters))
	for k, v := range snap.Counters {
		c.counters[k] = &counter{value: v}
	}
	c.gauges = make(map[string]*gauge, len(snap.Gauges))
	for k, v := range snap.Gauges {
		c.gauges[k] = &gauge{value: v}
	}
	c.sets = make(map[string]*set, len(snap.Sets))
	for k, members := range snap.Sets {
		s := &set{members: make(map[string]bool, len(members))}
		for _, m := range members {
			s.members[m] = true
		}
		c.sets[k] = s
	}
	c.hlls = make(map[string]*hll, len(snap.HLLs))
	for k, data := range snap.HLLs {
		h := &hll{sketch: hyperloglog.New()}
		if err := h.sketch.UnmarshalBinary(data); err == nil {
			c.hlls[k] = h
		}
	}
	c.timers = make(map[string]*timer, len(snap.Timers))
	for k, samples := range snap.Timers {
		t := &timer{}
		t.samples = make([]int64, len(samples))
		copy(t.samples, samples)
		c.timers[k] = t
	}
}
