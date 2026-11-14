// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package stats

// ExpiredKey represents a single key that has been evicted from the
// in-memory store by the TTL cleanup mechanism. It is passed to the
// ExpireFunc callback so the caller can persist it to any destination
// (SQLite, MySQL, PostgreSQL, Kafka, file, remote API, etc.).
//
// Fields:
//   - Key:      the full stats key, e.g. "pv:2026-08-18:/home"
//   - Type:     primitive type: "counter", "gauge", "set", "hll", "timer"
//   - Value:    type-specific value:
//     counter → int64
//     gauge   → int64
//     set     → int (count)
//     hll     → uint64 (estimated cardinality)
//     timer   → TimerSummary
//   - Date:     extracted "YYYY-MM-DD" from the key (empty if no date found)
//   - ExpiredAt: ISO 8601 timestamp of when the key was expired
type ExpiredKey struct {
	Key       string `json:"key"`
	Type      string `json:"type"`
	Value     any    `json:"value"`
	Date      string `json:"date"`
	ExpiredAt string `json:"expiredAt"`
}

// TimerSummary is a summary of a Timer at expiration time.
// It is the Value field of ExpiredKey when Type == "timer".
type TimerSummary struct {
	Count int64   `json:"count"`
	Mean  float64 `json:"mean"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99"`
}

// ExpireFunc is the callback invoked when a key expires from the
// in-memory store. The implementation is entirely up to the caller —
// write to a database, send to a message queue, append to a file, or
// simply ignore it.
//
// If the function returns an error, the key is NOT removed from memory
// and will be retried on the next cleanup cycle.
//
// Example (write to any database):
//
//	c := memory.New(
//	    memory.WithTTL(memory.TTLConfig{
//	        RetentionDays: 7,
//	        OnExpire: func(ek stats.ExpiredKey) error {
//	            _, err := db.Exec(
//	                "INSERT INTO stats_archive (key, type, value, date) VALUES (?, ?, ?, ?)",
//	                ek.Key, ek.Type, toJSON(ek.Value), ek.Date,
//	            )
//	            return err
//	        },
//	    }),
//	)
type ExpireFunc func(ek ExpiredKey) error
