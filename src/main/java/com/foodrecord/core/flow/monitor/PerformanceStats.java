package com.foodrecord.core.flow.monitor;

import java.util.HashMap;
import java.util.Map;

public class PerformanceStats {
    private long totalExecutions;
    private double averageExecutionTime;
    private double successRate;
    private Map<String, NodeStats> nodeStats;

    public PerformanceStats() {
        this.nodeStats = new HashMap<>();
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

    public Map<String, NodeStats> getNodeStats() {
        return nodeStats;
    }

    public void setNodeStats(Map<String, NodeStats> nodeStats) {
        this.nodeStats = nodeStats;
    }

    public static class NodeStats {
        private long executionCount;
        private double averageExecutionTime;
        private double errorRate;

        public long getExecutionCount() {
            return executionCount;
        }

        public void setExecutionCount(long executionCount) {
            this.executionCount = executionCount;
        }

        public double getAverageExecutionTime() {
            return averageExecutionTime;
        }

        public void setAverageExecutionTime(double averageExecutionTime) {
            this.averageExecutionTime = averageExecutionTime;
        }

        public double getErrorRate() {
            return errorRate;
        }

        public void setErrorRate(double errorRate) {
            this.errorRate = errorRate;
        }
    }
} 