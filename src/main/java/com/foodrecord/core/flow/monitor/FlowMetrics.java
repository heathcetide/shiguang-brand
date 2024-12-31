package com.foodrecord.core.flow.monitor;

public class FlowMetrics {
    private long totalExecutions;
    private double averageExecutionTime;
    private double successRate;
    private long lastExecutionTime;

    public FlowPerformanceMonitor.PerformanceStats toPerformanceStats() {
        FlowPerformanceMonitor.PerformanceStats stats = new FlowPerformanceMonitor.PerformanceStats();
        stats.setTotalExecutions(totalExecutions);
        stats.setAverageExecutionTime(averageExecutionTime);
        stats.setSuccessRate(successRate);
        return stats;
    }

    public long getTotalExecutions() {
        return totalExecutions;
    }

    public void setTotalExecutions(long totalExecutions) {
        this.totalExecutions = totalExecutions;
    }

    public double getAverageExecutionTime() {
        return averageExecutionTime;
    }

    public void setAverageExecutionTime(double averageExecutionTime) {
        this.averageExecutionTime = averageExecutionTime;
    }

    public double getSuccessRate() {
        return successRate;
    }

    public void setSuccessRate(double successRate) {
        this.successRate = successRate;
    }

    public long getLastExecutionTime() {
        return lastExecutionTime;
    }

    public void setLastExecutionTime(long lastExecutionTime) {
        this.lastExecutionTime = lastExecutionTime;
    }
} 