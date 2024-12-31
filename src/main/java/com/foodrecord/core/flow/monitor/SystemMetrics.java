package com.foodrecord.core.flow.monitor;

public class SystemMetrics {
    private double cpuUsage;
    private double memoryUsage;
    private int activeThreads;
    private int queuedTasks;
    private double systemLoadAverage;

    public double getCpuUsage() {
        return cpuUsage;
    }

    public void setCpuUsage(double cpuUsage) {
        this.cpuUsage = cpuUsage;
    }

    public double getMemoryUsage() {
        return memoryUsage;
    }

    public void setMemoryUsage(double memoryUsage) {
        this.memoryUsage = memoryUsage;
    }

    public int getActiveThreads() {
        return activeThreads;
    }

    public void setActiveThreads(int activeThreads) {
        this.activeThreads = activeThreads;
    }

    public int getQueuedTasks() {
        return queuedTasks;
    }

    public void setQueuedTasks(int queuedTasks) {
        this.queuedTasks = queuedTasks;
    }

    public double getSystemLoadAverage() {
        return systemLoadAverage;
    }

    public void setSystemLoadAverage(double systemLoadAverage) {
        this.systemLoadAverage = systemLoadAverage;
    }
} 