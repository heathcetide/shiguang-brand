// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package mq

import "sync/atomic"

// atomicCounter is a thin wrapper around int64 for metrics.
type atomicCounter struct{ v atomic.Int64 }

func (c *atomicCounter) add(n int64) { c.v.Add(n) }
func (c *atomicCounter) inc()        { c.v.Add(1) }
func (c *atomicCounter) load() int64 { return c.v.Load() }

// MetricsCollector methods — defined here to keep mq.go focused on
// the public API.
func (m *MetricsCollector) RecordPublish()     { m.published.inc() }
func (m *MetricsCollector) RecordConsume()     { m.consumed.inc() }
func (m *MetricsCollector) RecordAck()         { m.acked.inc() }
func (m *MetricsCollector) RecordNack()        { m.nacked.inc() }
func (m *MetricsCollector) RecordReject()      { m.rejected.inc() }
func (m *MetricsCollector) RecordRedelivered() { m.redelivered.inc() }
func (m *MetricsCollector) RecordError()       { m.errors.inc() }

// NewMetricsCollector returns a fresh collector.
func NewMetricsCollector() *MetricsCollector { return &MetricsCollector{} }
