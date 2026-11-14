// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package memory

import (
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stats"
)

// TTLConfig configures time-to-live based automatic cleanup for the
// in-memory collector. Keys containing a date prefix (e.g. "pv:2026-08-18:...")
// are eligible for expiration.
//
// When a key expires:
//  1. The OnExpire callback is invoked with the key and its final value.
//  2. The key is removed from all in-memory maps.
//
// This ensures bounded memory usage for long-running services: only the
// most recent `retentionDays` of data stays in memory, while older data
// is flushed to external storage via the callback.
//
// OnExpire is a pure callback — implement it however you like:
//
//	memory.WithTTL(memory.TTLConfig{
//	    RetentionDays: 7,
//	    OnExpire: func(ek stats.ExpiredKey) error {
//	        // Write to SQLite, MySQL, Postgres, Kafka, file, HTTP API...
//	        return db.Save(ek)
//	    },
//	})
type TTLConfig struct {
	// RetentionDays is the number of days of data to keep in memory.
	// Keys with dates older than this are expired.
	// Default: 7
	RetentionDays int

	// CheckInterval is how often the cleanup goroutine runs.
	// Default: 1 hour
	CheckInterval time.Duration

	// OnExpire is called for each expired key before removal.
	// If it returns an error, the key is NOT removed (will retry next cycle).
	// If nil, keys are removed silently.
	OnExpire stats.ExpireFunc

	// KeyDateExtractor extracts a date from a key string.
	// If it returns ok=false, the key is never expired.
	// Default: extracts "YYYY-MM-DD" from any position in the key.
	KeyDateExtractor func(key string) (date string, ok bool)
}

// DefaultKeyDateExtractor extracts a "YYYY-MM-DD" date from a key.
// It searches for a 10-character substring matching the date pattern.
// Returns ok=false if no date is found.
func DefaultKeyDateExtractor(key string) (string, bool) {
	// Look for "YYYY-MM-DD" pattern anywhere in the key.
	// Format: 4 digits + "-" + 2 digits + "-" + 2 digits
	for i := 0; i <= len(key)-10; i++ {
		if isDigit(key[i]) && isDigit(key[i+1]) && isDigit(key[i+2]) && isDigit(key[i+3]) &&
			key[i+4] == '-' &&
			isDigit(key[i+5]) && isDigit(key[i+6]) &&
			key[i+7] == '-' &&
			isDigit(key[i+8]) && isDigit(key[i+9]) {
			return key[i : i+10], true
		}
	}
	return "", false
}

func isDigit(b byte) bool {
	return b >= '0' && b <= '9'
}

// ttlManager runs a background goroutine that periodically checks for
// expired keys and invokes the OnExpire callback before removing them.
type ttlManager struct {
	config    TTLConfig
	collector *Collector
	stopCh    chan struct{}
	wg        sync.WaitGroup
}

func newTTLManager(c *Collector, config TTLConfig) *ttlManager {
	if config.RetentionDays <= 0 {
		config.RetentionDays = 7
	}
	if config.CheckInterval <= 0 {
		config.CheckInterval = time.Hour
	}
	if config.KeyDateExtractor == nil {
		config.KeyDateExtractor = DefaultKeyDateExtractor
	}
	return &ttlManager{
		config:    config,
		collector: c,
		stopCh:    make(chan struct{}),
	}
}

func (m *ttlManager) start() {
	m.wg.Add(1)
	go m.loop()
}

func (m *ttlManager) stop() {
	close(m.stopCh)
	m.wg.Wait()
}

func (m *ttlManager) loop() {
	defer m.wg.Done()

	ticker := time.NewTicker(m.config.CheckInterval)
	defer ticker.Stop()

	// Run once at start (after a short delay to allow initialization).
	initialTimer := time.NewTimer(5 * time.Second)
	defer initialTimer.Stop()

	for {
		select {
		case <-m.stopCh:
			return
		case <-initialTimer.C:
			m.cleanup()
		case <-ticker.C:
			m.cleanup()
		}
	}
}

func (m *ttlManager) cleanup() {
	cutoff := time.Now().AddDate(0, 0, -m.config.RetentionDays)
	cutoffStr := cutoff.Format("2006-01-02")
	now := time.Now().Format(time.RFC3339)

	m.collector.mu.Lock()
	defer m.collector.mu.Unlock()

	// Counters
	for key, ctr := range m.collector.counters {
		date, ok := m.config.KeyDateExtractor(key)
		if !ok || date >= cutoffStr {
			continue
		}
		if m.config.OnExpire != nil {
			ek := stats.ExpiredKey{Key: key, Type: "counter", Value: ctr.Get(), Date: date, ExpiredAt: now}
			if err := m.config.OnExpire(ek); err != nil {
				continue
			}
		}
		delete(m.collector.counters, key)
	}

	// Gauges
	for key, g := range m.collector.gauges {
		date, ok := m.config.KeyDateExtractor(key)
		if !ok || date >= cutoffStr {
			continue
		}
		if m.config.OnExpire != nil {
			ek := stats.ExpiredKey{Key: key, Type: "gauge", Value: g.Get(), Date: date, ExpiredAt: now}
			if err := m.config.OnExpire(ek); err != nil {
				continue
			}
		}
		delete(m.collector.gauges, key)
	}

	// Sets
	for key, s := range m.collector.sets {
		date, ok := m.config.KeyDateExtractor(key)
		if !ok || date >= cutoffStr {
			continue
		}
		if m.config.OnExpire != nil {
			ek := stats.ExpiredKey{Key: key, Type: "set", Value: s.Count(), Date: date, ExpiredAt: now}
			if err := m.config.OnExpire(ek); err != nil {
				continue
			}
		}
		delete(m.collector.sets, key)
	}

	// HLLs
	for key, h := range m.collector.hlls {
		date, ok := m.config.KeyDateExtractor(key)
		if !ok || date >= cutoffStr {
			continue
		}
		if m.config.OnExpire != nil {
			ek := stats.ExpiredKey{Key: key, Type: "hll", Value: h.Estimate(), Date: date, ExpiredAt: now}
			if err := m.config.OnExpire(ek); err != nil {
				continue
			}
		}
		delete(m.collector.hlls, key)
	}

	// Timers
	for key, t := range m.collector.timers {
		date, ok := m.config.KeyDateExtractor(key)
		if !ok || date >= cutoffStr {
			continue
		}
		if m.config.OnExpire != nil {
			ek := stats.ExpiredKey{
				Key:       key,
				Type:      "timer",
				Date:      date,
				ExpiredAt: now,
				Value: stats.TimerSummary{
					Count: t.Count(),
					Mean:  t.Mean(),
					P50:   t.Percentile(50),
					P95:   t.Percentile(95),
					P99:   t.Percentile(99),
				},
			}
			if err := m.config.OnExpire(ek); err != nil {
				continue
			}
		}
		delete(m.collector.timers, key)
	}
}

// WithTTL enables automatic TTL-based cleanup of old keys.
//
// Keys containing a date prefix (e.g. "pv:2026-08-18:/home") older than
// RetentionDays are automatically expired. Before removal, OnExpire is
// called so the caller can persist data anywhere.
//
// OnExpire is a pure callback — no implementation class required:
//
//	c := memory.New(
//	    memory.WithTTL(memory.TTLConfig{
//	        RetentionDays: 7,
//	        OnExpire: func(ek stats.ExpiredKey) error {
//	            // Write to any database, file, Kafka, HTTP API...
//	            _, err := db.Exec("INSERT INTO archive ...", ek.Key, ek.Value)
//	            return err
//	        },
//	    }),
//	)
func WithTTL(config TTLConfig) Option {
	return func(c *Collector) {
		c.ttlConfig = &config
	}
}

// extractDate is a helper that uses the configured KeyDateExtractor.
func (c *Collector) extractDate(key string) (string, bool) {
	if c.ttlConfig == nil || c.ttlConfig.KeyDateExtractor == nil {
		return DefaultKeyDateExtractor(key)
	}
	return c.ttlConfig.KeyDateExtractor(key)
}

// KeyCount returns the total number of keys across all primitive types.
// Useful for monitoring memory growth.
func (c *Collector) KeyCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.counters) + len(c.gauges) + len(c.sets) + len(c.hlls) + len(c.timers)
}

// CleanupNow triggers an immediate TTL cleanup cycle (blocking).
// Returns the number of keys removed.
func (c *Collector) CleanupNow() int {
	if c.ttlManager == nil {
		return 0
	}
	before := c.KeyCount()
	c.ttlManager.cleanup()
	after := c.KeyCount()
	return before - after
}

// suppress unused import warning
var _ = strings.Contains
