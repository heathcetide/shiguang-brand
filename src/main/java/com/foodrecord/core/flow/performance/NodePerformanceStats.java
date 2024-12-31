package com.foodrecord.core.flow.performance;

public class NodePerformanceStats {
    private String nodeId;
    private double averageExecutionTime;
    private long totalExecutions;
    private double successRate;
    private double cpuUsage;
    private double memoryUsage;
    private double throughput;
    private long totalDuration;
    private long minDuration = Long.MAX_VALUE;
    private long maxDuration;

    public NodePerformanceStats() {
        this.totalExecutions = 0;
        this.totalDuration = 0;
        this.successRate = 1.0;
    }

    public void addExecution(long duration) {
        totalExecutions++;
        totalDuration += duration;
        minDuration = Math.min(minDuration, duration);
        maxDuration = Math.max(maxDuration, duration);
        averageExecutionTime = (double) totalDuration / totalExecutions;
    }

    public double getAverageDuration() {
        return totalExecutions > 0 ? (double) totalDuration / totalExecutions : 0;
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public double getAverageExecutionTime() {
        return averageExecutionTime;
    }

    public void setAverageExecutionTime(double averageExecutionTime) {
        this.averageExecutionTime = averageExecutionTime;
    }

    public long getTotalExecutions() {
        return totalExecutions;
    }

    public void setTotalExecutions(long totalExecutions) {
        this.totalExecutions = totalExecutions;
    }

    public double getSuccessRate() {
        return successRate;
    }

    public void setSuccessRate(double successRate) {
        this.successRate = successRate;
    }

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

    public double getThroughput() {
        return throughput;
    }

    public void setThroughput(double throughput) {
        this.throughput = throughput;
    }

    public long getTotalDuration() {
        return totalDuration;
    }

    public long getMinDuration() {
        return minDuration == Long.MAX_VALUE ? 0 : minDuration;
    }

    public long getMaxDuration() {
        return maxDuration;
    }
} 