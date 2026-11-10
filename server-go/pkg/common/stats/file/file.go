// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package file provides a file-persisted stats collector.
// It wraps the in-memory collector and periodically (or on Flush) saves
// state to a gob-encoded file. On startup, the file is loaded to restore
// previous state.
package file

import (
	"encoding/gob"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stats"
	"github.com/heathcetide/DietDigiDose/pkg/common/stats/memory"
)

// Collector wraps memory.Collector with file persistence.
// It implements stats.Collector.
type Collector struct {
	inner *memory.Collector
	path  string
	mu    sync.Mutex

	autoFlush *time.Ticker
	stopCh    chan struct{}
}

// Option configures the file collector.
type Option func(*Collector)

// WithAutoFlush enables periodic auto-flush at the given interval.
func WithAutoFlush(interval time.Duration) Option {
	return func(c *Collector) {
		c.autoFlush = time.NewTicker(interval)
		c.stopCh = make(chan struct{})
	}
}

// New creates a file-persisted collector. The file is loaded on startup
// (if it exists) and saved on Flush/Close.
func New(path string, opts ...Option) (*Collector, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	c := &Collector{path: path, inner: memory.New()}
	for _, opt := range opts {
		opt(c)
	}

	if err := c.load(); err != nil {
		return nil, err
	}

	if c.autoFlush != nil {
		go c.autoFlushLoop()
	}
	return c, nil
}

// Counter delegates to the inner memory collector.
func (c *Collector) Counter(key string) stats.Counter { return c.inner.Counter(key) }

// Gauge delegates to the inner memory collector.
func (c *Collector) Gauge(key string) stats.Gauge { return c.inner.Gauge(key) }

// Set delegates to the inner memory collector.
func (c *Collector) Set(key string) stats.Set { return c.inner.Set(key) }

// HLL delegates to the inner memory collector.
func (c *Collector) HLL(key string) stats.HLL { return c.inner.HLL(key) }

// Timer delegates to the inner memory collector.
func (c *Collector) Timer(key string) stats.Timer { return c.inner.Timer(key) }

func (c *Collector) autoFlushLoop() {
	for {
		select {
		case <-c.autoFlush.C:
			_ = c.Flush()
		case <-c.stopCh:
			return
		}
	}
}

// Flush persists state to file.
func (c *Collector) Flush() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.save(c.inner.Snapshot())
}

// Close flushes state and stops auto-flush.
func (c *Collector) Close() error {
	if c.autoFlush != nil {
		c.autoFlush.Stop()
		if c.stopCh != nil {
			close(c.stopCh)
		}
	}
	return c.Flush()
}

func (c *Collector) save(snap *memory.Snapshot) error {
	f, err := os.Create(c.path)
	if err != nil {
		return err
	}
	defer f.Close()
	return gob.NewEncoder(f).Encode(snap)
}

func (c *Collector) load() error {
	f, err := os.Open(c.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	var snap memory.Snapshot
	if err := gob.NewDecoder(f).Decode(&snap); err != nil {
		return err
	}
	c.inner.Restore(&snap)
	return nil
}
