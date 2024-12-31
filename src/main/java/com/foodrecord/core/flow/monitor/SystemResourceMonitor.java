package com.foodrecord.core.flow.monitor;

import org.springframework.stereotype.Component;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.ThreadMXBean;
import com.sun.management.OperatingSystemMXBean;

@Component
public class SystemResourceMonitor {
    private final OperatingSystemMXBean osBean;
    private final MemoryMXBean memoryBean;
    private final ThreadMXBean threadBean;
    
    public SystemResourceMonitor() {
        this.osBean = (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
        this.memoryBean = ManagementFactory.getMemoryMXBean();
        this.threadBean = ManagementFactory.getThreadMXBean();
    }
    
    public SystemMetrics collectMetrics() {
        SystemMetrics metrics = new SystemMetrics();
        metrics.setCpuUsage(osBean.getProcessCpuLoad() * 100);
        metrics.setMemoryUsage(getMemoryUsage());
        metrics.setActiveThreads(threadBean.getThreadCount());
        metrics.setSystemLoadAverage(osBean.getSystemLoadAverage());
        return metrics;
    }
    
    private double getMemoryUsage() {
        long used = memoryBean.getHeapMemoryUsage().getUsed();
        long max = memoryBean.getHeapMemoryUsage().getMax();
        return ((double) used / max) * 100;
    }
    
    public ThreadMetrics collectThreadMetrics() {
        ThreadMetrics metrics = new ThreadMetrics();
        metrics.setTotalStartedThreadCount(threadBean.getTotalStartedThreadCount());
        metrics.setPeakThreadCount(threadBean.getPeakThreadCount());
        metrics.setDaemonThreadCount(threadBean.getDaemonThreadCount());
        metrics.setDeadlockedThreads(threadBean.findDeadlockedThreads());
        return metrics;
    }
} 