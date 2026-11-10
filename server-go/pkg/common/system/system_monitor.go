package system

import (
	"os"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
)

// DiskSpaceInfo 磁盘空间信息
type DiskSpaceInfo struct {
	// 总空间（字节）
	Total uint64 `json:"total"`
	// 可用空间（字节）
	Free uint64 `json:"free"`
	// 已用空间（字节）
	Used uint64 `json:"used"`
	// 使用百分比
	UsedPercent float64 `json:"used_percent"`
}

// SystemStatus 系统状态信息
type SystemStatus struct {
	CPUUsage    float64
	MemoryUsage float64
	DiskUsage   float64
}

var latestSystemStatus atomic.Value

func init() {
	latestSystemStatus.Store(SystemStatus{})
}

// StartSystemMonitor 启动系统监控
func StartSystemMonitor() {
	go func() {
		for {
			config := GetPerformanceMonitorConfig()
			if !config.Enabled {
				time.Sleep(30 * time.Second)
				continue
			}

			updateSystemStatus()
			time.Sleep(5 * time.Second)
		}
	}()
}

func updateSystemStatus() {
	var status SystemStatus
	// CPU
	// 注意：cpu.Percent(0, false) 返回自上次调用以来的 CPU 使用率
	// 如果是第一次调用，可能会返回错误或不准确的值，但在循环中会逐渐正常
	percents, err := cpu.Percent(0, false)
	if err == nil && len(percents) > 0 {
		status.CPUUsage = percents[0]
	}

	// Memory
	memInfo, err := mem.VirtualMemory()
	if err == nil {
		status.MemoryUsage = memInfo.UsedPercent
	}

	// Disk
	diskInfo := GetDiskSpaceInfo()
	if diskInfo.Total > 0 {
		status.DiskUsage = diskInfo.UsedPercent
	}

	latestSystemStatus.Store(status)
	SyncPrometheusRuntimeGauges()
	// System status stays at 5s for live gauges; trend series is slower
	// (default 30s) to keep JSONL / ReadMemStats cost reasonable.
	if ShouldSampleTrend() {
		recordMonitorTrend(status)
	}
}

// recordMonitorTrend samples lightweight MemStats + goroutine count into the
// trend ring / data/runtime-trends JSONL so /system/status can show history.
func recordMonitorTrend(status SystemStatus) {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	n := runtime.NumGoroutine()
	for {
		old := atomic.LoadInt64(&goroutineHighWater)
		if int64(n) <= old {
			break
		}
		if atomic.CompareAndSwapInt64(&goroutineHighWater, old, int64(n)) {
			break
		}
	}

	p := RuntimeTrendPoint{
		Ts:          time.Now().UnixMilli(),
		HeapAlloc:   ms.HeapAlloc,
		HeapInuse:   ms.HeapInuse,
		HeapObjects: ms.HeapObjects,
		Sys:         ms.Sys,
		Goroutines:  n,
		NumGC:       ms.NumGC,
		CPUUsage:    status.CPUUsage,
		MemoryUsage: status.MemoryUsage,
	}
	if rss, ok := sampleProcessRSS(); ok {
		p.ProcessRSS = rss
	}
	RecordRuntimeTrend(p)
}

func sampleProcessRSS() (uint64, bool) {
	proc, err := process.NewProcess(int32(os.Getpid()))
	if err != nil {
		return 0, false
	}
	mi, err := proc.MemoryInfo()
	if err != nil || mi == nil {
		return 0, false
	}
	return mi.RSS, true
}

// GetSystemStatus 获取当前系统状态
func GetSystemStatus() SystemStatus {
	return latestSystemStatus.Load().(SystemStatus)
}
