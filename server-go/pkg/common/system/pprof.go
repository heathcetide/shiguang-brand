package system

import (
	"fmt"
	"os"
	"runtime"
	"runtime/pprof"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
)

// cpuPProfThreshold 触发自动 CPU profile 的百分比阈值。
// 受 PerformanceMonitorConfig.CPUThreshold 控制，可在运行时通过 listener 调整。
const defaultCPUPProfThreshold = 80.0

// defaultMemPProfThreshold 触发自动 heap profile 的主机内存使用率阈值。
const defaultMemPProfThreshold = 85.0

// pprofDir 是 pprof 文件落地目录；运行时下若已存在则复用，不存在时尝试创建。
// 可通过 SetPProfDir 在启动时配置。
var pprofDir = "./pprof"

// SetPProfDir 配置 pprof 文件落地目录。必须在 Monitor 启动前调用。
// 传空字符串则恢复默认值 "./pprof"。
func SetPProfDir(dir string) {
	if dir == "" {
		dir = "./pprof"
	}
	pprofDir = dir
}

// heap dump 冷却，避免内存持续偏高时刷爆磁盘。
const heapDumpCooldown = 10 * time.Minute

var lastHeapDumpAt time.Time

// Monitor 定时监控 CPU / 内存，超阈值则采样 profile。
//
// 设计要点：
//   - 每轮采样失败不再 panic；记 warn 然后下一轮重试。
//   - 阈值实时读取 PerformanceMonitorConfig，运维可通过 listener 调整。
//   - CPU 采样窗口固定 10 s；heap dump 有冷却，避免磁盘被刷爆。
//   - 文件以时间戳命名，便于排序。
func Monitor() {
	for {
		cfg := GetPerformanceMonitorConfig()
		if !cfg.Enabled {
			time.Sleep(30 * time.Second)
			continue
		}
		cpuThreshold := float64(cfg.CPUThreshold)
		if cpuThreshold <= 0 {
			cpuThreshold = defaultCPUPProfThreshold
		}
		memThreshold := float64(cfg.MemoryThreshold)
		if memThreshold <= 0 {
			memThreshold = defaultMemPProfThreshold
		}

		percent, err := cpu.Percent(time.Second, false)
		if err != nil || len(percent) == 0 {
			logger.Warn("cpu monitor sample failed: " + safeErrMsg(err))
		} else if percent[0] > cpuThreshold {
			logger.Warn(fmt.Sprintf("cpu usage too high: %.2f%% (threshold=%.2f%%) — capturing cpu pprof",
				percent[0], cpuThreshold))
			captureCPUProfile()
		}

		if mi, err := mem.VirtualMemory(); err != nil {
			logger.Warn("memory monitor sample failed: " + safeErrMsg(err))
		} else if mi.UsedPercent > memThreshold {
			if time.Since(lastHeapDumpAt) >= heapDumpCooldown {
				logger.Warn(fmt.Sprintf("memory usage too high: %.2f%% (threshold=%.2f%%) — capturing heap pprof",
					mi.UsedPercent, memThreshold))
				captureHeapProfile()
				lastHeapDumpAt = time.Now()
			}
		}

		time.Sleep(30 * time.Second)
	}
}

func ensurePProfDir() bool {
	if _, err := os.Stat(pprofDir); os.IsNotExist(err) {
		if err := os.Mkdir(pprofDir, os.ModePerm); err != nil {
			logger.Error("create pprof dir failed: " + err.Error())
			return false
		}
	}
	return true
}

func captureCPUProfile() {
	if !ensurePProfDir() {
		return
	}
	path := fmt.Sprintf("%s/cpu-%s.pprof", pprofDir, time.Now().Format("20060102150405"))
	f, err := os.Create(path)
	if err != nil {
		logger.Error("create pprof file failed: " + err.Error())
		return
	}
	defer f.Close()
	if err := pprof.StartCPUProfile(f); err != nil {
		logger.Error("start pprof failed: " + err.Error())
		return
	}
	time.Sleep(10 * time.Second)
	pprof.StopCPUProfile()
	logger.Info("pprof captured: " + path)
}

func captureHeapProfile() {
	if !ensurePProfDir() {
		return
	}
	// Encourage a GC so the dump reflects live objects more accurately.
	runtime.GC()
	path := fmt.Sprintf("%s/heap-%s.pprof", pprofDir, time.Now().Format("20060102150405"))
	f, err := os.Create(path)
	if err != nil {
		logger.Error("create heap pprof file failed: " + err.Error())
		return
	}
	defer f.Close()
	if err := pprof.WriteHeapProfile(f); err != nil {
		logger.Error("write heap pprof failed: " + err.Error())
		return
	}
	logger.Info("heap pprof captured: " + path)
}

func safeErrMsg(err error) string {
	if err == nil {
		return "<nil>"
	}
	return err.Error()
}
