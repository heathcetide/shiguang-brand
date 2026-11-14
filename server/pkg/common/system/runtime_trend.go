package system

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common"
	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
)

const (
	defaultTrendDir      = "./data/runtime-trends"
	defaultTrendInterval = 30   // seconds; leak trends don't need 5s granularity
	defaultTrendRingCap  = 2880 // ~24h at 30s
	defaultTrendRetainD  = 7
	maxTrendResponsePts  = 720
	trendFileDateLayout  = "20060102"
)

// RuntimeTrendPoint is one lightweight sample for leak/OOM trend charts.
type RuntimeTrendPoint struct {
	Ts          int64   `json:"ts"` // unix milliseconds
	HeapAlloc   uint64  `json:"heapAlloc"`
	HeapInuse   uint64  `json:"heapInuse"`
	HeapObjects uint64  `json:"heapObjects"`
	Sys         uint64  `json:"sys"`
	Goroutines  int     `json:"goroutines"`
	NumGC       uint32  `json:"numGC"`
	CPUUsage    float64 `json:"cpuUsage"`
	MemoryUsage float64 `json:"memoryUsage"`
	ProcessRSS  uint64  `json:"processRss,omitempty"`
}

// RuntimeTrendSummary is a coarse rising/falling signal for ops dashboards.
type RuntimeTrendSummary struct {
	SampleCount     int   `json:"sampleCount"`
	WindowMs        int64 `json:"windowMs"`
	HeapAllocDelta  int64 `json:"heapAllocDelta"`
	GoroutineDelta  int   `json:"goroutineDelta"`
	HeapAllocRising bool  `json:"heapAllocRising"`
	GoroutineRising bool  `json:"goroutineRising"`
	FirstTs         int64 `json:"firstTs,omitempty"`
	LastTs          int64 `json:"lastTs,omitempty"`
}

// RuntimeTrendSnapshot is returned by /system/status.
type RuntimeTrendSnapshot struct {
	IntervalSeconds int                 `json:"intervalSeconds"`
	PersistDir      string              `json:"persistDir"`
	Points          []RuntimeTrendPoint `json:"points"`
	Summary         RuntimeTrendSummary `json:"summary"`
}

type trendStore struct {
	mu           sync.RWMutex
	ring         []RuntimeTrendPoint
	cap          int
	dir          string
	retainD      int
	intervalSec  int
	loaded       bool
	lastDay      string
	lastSampleAt time.Time
	file         *os.File
	writer       *bufio.Writer
}

var trends = &trendStore{
	cap:         defaultTrendRingCap,
	dir:         defaultTrendDir,
	retainD:     defaultTrendRetainD,
	intervalSec: defaultTrendInterval,
}

func init() {
	if d := strings.TrimSpace(common.GetEnv("RUNTIME_TREND_DIR")); d != "" {
		trends.dir = d
	}
	if n := common.GetIntEnv("RUNTIME_TREND_RING_CAP"); n > 60 {
		trends.cap = int(n)
	}
	if n := common.GetIntEnv("RUNTIME_TREND_RETAIN_DAYS"); n > 0 {
		trends.retainD = int(n)
	}
	// Clamp to [10s, 5m] — below 10s burns disk/CPU; above 5m is too coarse for leak slope.
	if n := common.GetIntEnv("RUNTIME_TREND_INTERVAL_SECONDS"); n >= 10 && n <= 300 {
		trends.intervalSec = int(n)
	}
}

// TrendSampleInterval returns the configured trend sample interval.
func TrendSampleInterval() time.Duration {
	trends.mu.RLock()
	defer trends.mu.RUnlock()
	sec := trends.intervalSec
	if sec <= 0 {
		sec = defaultTrendInterval
	}
	return time.Duration(sec) * time.Second
}

// ShouldSampleTrend reports whether enough time has passed since the last trend sample.
func ShouldSampleTrend() bool {
	trends.mu.RLock()
	defer trends.mu.RUnlock()
	if trends.lastSampleAt.IsZero() {
		return true
	}
	return time.Since(trends.lastSampleAt) >= time.Duration(trends.intervalSec)*time.Second
}

// RecordRuntimeTrend appends one sample to the in-memory ring and JSONL on disk.
// Callers should gate with ShouldSampleTrend() so the 5s system monitor does not
// over-sample; this function itself always records when invoked.
func RecordRuntimeTrend(p RuntimeTrendPoint) {
	if p.Ts <= 0 {
		p.Ts = time.Now().UnixMilli()
	}
	trends.append(p)
}

// GetRuntimeTrend returns points within the given window (e.g. 15m / 1h / 6h / 24h).
// Empty window defaults to 1h. Points are downsampled to maxTrendResponsePts.
func GetRuntimeTrend(window string) RuntimeTrendSnapshot {
	win := parseTrendWindow(window)
	now := time.Now().UnixMilli()
	since := now - win.Milliseconds()

	trends.mu.RLock()
	defer trends.mu.RUnlock()

	raw := make([]RuntimeTrendPoint, 0, len(trends.ring))
	for _, p := range trends.ring {
		if p.Ts >= since {
			raw = append(raw, p)
		}
	}
	points := downsampleTrend(raw, maxTrendResponsePts)
	interval := trends.intervalSec
	if interval <= 0 {
		interval = defaultTrendInterval
	}
	return RuntimeTrendSnapshot{
		IntervalSeconds: interval,
		PersistDir:      trends.dir,
		Points:          points,
		Summary:         summarizeTrend(points, win.Milliseconds()),
	}
}

func parseTrendWindow(s string) time.Duration {
	s = strings.TrimSpace(strings.ToLower(s))
	switch s {
	case "", "1h", "60m":
		return time.Hour
	case "15m":
		return 15 * time.Minute
	case "30m":
		return 30 * time.Minute
	case "6h":
		return 6 * time.Hour
	case "12h":
		return 12 * time.Hour
	case "24h", "1d":
		return 24 * time.Hour
	default:
		if d, err := time.ParseDuration(s); err == nil && d > 0 && d <= 7*24*time.Hour {
			return d
		}
		return time.Hour
	}
}

func summarizeTrend(points []RuntimeTrendPoint, windowMs int64) RuntimeTrendSummary {
	sum := RuntimeTrendSummary{SampleCount: len(points), WindowMs: windowMs}
	if len(points) < 2 {
		if len(points) == 1 {
			sum.FirstTs = points[0].Ts
			sum.LastTs = points[0].Ts
		}
		return sum
	}
	first, last := points[0], points[len(points)-1]
	sum.FirstTs = first.Ts
	sum.LastTs = last.Ts
	sum.HeapAllocDelta = int64(last.HeapAlloc) - int64(first.HeapAlloc)
	sum.GoroutineDelta = last.Goroutines - first.Goroutines

	// Rising if net growth >10% (or +64MiB / +20 goroutines) and majority of
	// step deltas are non-negative — filters GC sawtooth noise.
	heapRisingSteps := 0
	grRisingSteps := 0
	steps := 0
	for i := 1; i < len(points); i++ {
		steps++
		if points[i].HeapAlloc >= points[i-1].HeapAlloc {
			heapRisingSteps++
		}
		if points[i].Goroutines >= points[i-1].Goroutines {
			grRisingSteps++
		}
	}
	if steps > 0 {
		heapGrowth := sum.HeapAllocDelta > int64(64<<20) ||
			(first.HeapAlloc > 0 && float64(sum.HeapAllocDelta) >= 0.10*float64(first.HeapAlloc))
		grGrowth := sum.GoroutineDelta >= 20 ||
			(first.Goroutines > 0 && float64(sum.GoroutineDelta) >= 0.10*float64(first.Goroutines))
		sum.HeapAllocRising = heapGrowth && float64(heapRisingSteps)/float64(steps) >= 0.55
		sum.GoroutineRising = grGrowth && float64(grRisingSteps)/float64(steps) >= 0.55
	}
	return sum
}

func downsampleTrend(in []RuntimeTrendPoint, maxPts int) []RuntimeTrendPoint {
	if maxPts <= 0 || len(in) <= maxPts {
		out := make([]RuntimeTrendPoint, len(in))
		copy(out, in)
		return out
	}
	out := make([]RuntimeTrendPoint, 0, maxPts)
	// Always keep first & last; pick evenly in between.
	out = append(out, in[0])
	inner := maxPts - 2
	for i := 1; i <= inner; i++ {
		idx := 1 + (i*(len(in)-2))/(inner+1)
		if idx <= 0 {
			idx = 1
		}
		if idx >= len(in)-1 {
			idx = len(in) - 2
		}
		out = append(out, in[idx])
	}
	out = append(out, in[len(in)-1])
	return out
}

func (s *trendStore) append(p RuntimeTrendPoint) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.loaded {
		s.loadLocked()
	}

	if len(s.ring) >= s.cap {
		// Drop oldest ~10% to avoid O(n) shift every sample.
		drop := s.cap / 10
		if drop < 1 {
			drop = 1
		}
		copy(s.ring, s.ring[drop:])
		s.ring = s.ring[:len(s.ring)-drop]
	}
	s.ring = append(s.ring, p)
	s.lastSampleAt = time.UnixMilli(p.Ts)

	if err := s.persistLocked(p); err != nil {
		logger.Warn("runtime trend persist failed: " + err.Error())
	}
}

func (s *trendStore) loadLocked() {
	s.loaded = true
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		logger.Warn("runtime trend mkdir failed: " + err.Error())
		return
	}
	s.pruneLocked()

	// Load today's + yesterday's files so a restart still has ~1 day of history.
	days := []string{
		time.Now().Add(-24 * time.Hour).Format(trendFileDateLayout),
		time.Now().Format(trendFileDateLayout),
	}
	var loaded []RuntimeTrendPoint
	for _, day := range days {
		path := filepath.Join(s.dir, day+".jsonl")
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			var p RuntimeTrendPoint
			if err := json.Unmarshal([]byte(line), &p); err != nil {
				continue
			}
			if p.Ts > 0 {
				loaded = append(loaded, p)
			}
		}
		_ = f.Close()
	}
	sort.Slice(loaded, func(i, j int) bool { return loaded[i].Ts < loaded[j].Ts })
	if len(loaded) > s.cap {
		loaded = loaded[len(loaded)-s.cap:]
	}
	s.ring = loaded
}

func (s *trendStore) persistLocked(p RuntimeTrendPoint) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	day := time.UnixMilli(p.Ts).Format(trendFileDateLayout)
	if s.file == nil || s.lastDay != day {
		if s.writer != nil {
			_ = s.writer.Flush()
		}
		if s.file != nil {
			_ = s.file.Close()
			s.file = nil
			s.writer = nil
		}
		path := filepath.Join(s.dir, day+".jsonl")
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		s.file = f
		s.writer = bufio.NewWriterSize(f, 32*1024)
		s.lastDay = day
		s.pruneLocked()
	}
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	if _, err := s.writer.Write(b); err != nil {
		return err
	}
	if err := s.writer.WriteByte('\n'); err != nil {
		return err
	}
	return s.writer.Flush()
}

func (s *trendStore) pruneLocked() {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -s.retainD).Format(trendFileDateLayout)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		day := strings.TrimSuffix(name, ".jsonl")
		if day < cutoff {
			_ = os.Remove(filepath.Join(s.dir, name))
		}
	}
}
