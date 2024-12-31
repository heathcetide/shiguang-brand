package com.foodrecord.core.flow.analytics;

public class ExecutionStats {
    private int totalExecutions;
    private double successRate;
    private long minDuration;
    private long maxDuration;
    private double avgDuration;
    private long p95Duration;
    private long p99Duration;

    public int getTotalExecutions() {
        return totalExecutions;
    }

    public void setTotalExecutions(int totalExecutions) {
        this.totalExecutions = totalExecutions;
    }

    public double getSuccessRate() {
        return successRate;
    }

    public void setSuccessRate(double successRate) {
        this.successRate = successRate;
    }

    public long getMinDuration() {
        return minDuration;
    }

    public void setMinDuration(long minDuration) {
        this.minDuration = minDuration;
    }

    public long getMaxDuration() {
        return maxDuration;
    }

    public void setMaxDuration(long maxDuration) {
        this.maxDuration = maxDuration;
    }

    public double getAvgDuration() {
        return avgDuration;
    }

    public void setAvgDuration(double avgDuration) {
        this.avgDuration = avgDuration;
    }

    public long getP95Duration() {
        return p95Duration;
    }

    public void setP95Duration(long p95Duration) {
        this.p95Duration = p95Duration;
    }

    public long getP99Duration() {
        return p99Duration;
    }

    public void setP99Duration(long p99Duration) {
        this.p99Duration = p99Duration;
    }
} 