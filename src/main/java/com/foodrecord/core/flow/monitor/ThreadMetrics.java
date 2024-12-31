package com.foodrecord.core.flow.monitor;

public class ThreadMetrics {
    private long totalStartedThreadCount;
    private int peakThreadCount;
    private int daemonThreadCount;
    private long[] deadlockedThreads;

    public long getTotalStartedThreadCount() {
        return totalStartedThreadCount;
    }

    public void setTotalStartedThreadCount(long totalStartedThreadCount) {
        this.totalStartedThreadCount = totalStartedThreadCount;
    }

    public int getPeakThreadCount() {
        return peakThreadCount;
    }

    public void setPeakThreadCount(int peakThreadCount) {
        this.peakThreadCount = peakThreadCount;
    }

    public int getDaemonThreadCount() {
        return daemonThreadCount;
    }

    public void setDaemonThreadCount(int daemonThreadCount) {
        this.daemonThreadCount = daemonThreadCount;
    }

    public long[] getDeadlockedThreads() {
        return deadlockedThreads;
    }

    public void setDeadlockedThreads(long[] deadlockedThreads) {
        this.deadlockedThreads = deadlockedThreads;
    }

    public boolean hasDeadlocks() {
        return deadlockedThreads != null && deadlockedThreads.length > 0;
    }
} 