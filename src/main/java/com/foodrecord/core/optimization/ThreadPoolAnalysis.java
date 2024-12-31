package com.foodrecord.core.optimization;

import java.util.ArrayList;
import java.util.List;

public class ThreadPoolAnalysis {
    private final List<ThreadPoolSuggestion> suggestions;
    private double utilization;
    private int poolSize;
    private int queueSize;
    private double averageTaskTime;
    private int rejectedTasks;

    public ThreadPoolAnalysis() {
        this.suggestions = new ArrayList<>();
    }

    public void addSuggestion(ThreadPoolSuggestion suggestion) {
        suggestions.add(suggestion);
    }

    public List<ThreadPoolSuggestion> getSuggestions() {
        return suggestions;
    }

    public double getUtilization() {
        return utilization;
    }

    public void setUtilization(double utilization) {
        this.utilization = utilization;
    }

    public int getPoolSize() {
        return poolSize;
    }

    public void setPoolSize(int poolSize) {
        this.poolSize = poolSize;
    }

    public int getQueueSize() {
        return queueSize;
    }

    public void setQueueSize(int queueSize) {
        this.queueSize = queueSize;
    }

    public double getAverageTaskTime() {
        return averageTaskTime;
    }

    public void setAverageTaskTime(double averageTaskTime) {
        this.averageTaskTime = averageTaskTime;
    }

    public int getRejectedTasks() {
        return rejectedTasks;
    }

    public void setRejectedTasks(int rejectedTasks) {
        this.rejectedTasks = rejectedTasks;
    }

    public boolean hasOptimizations() {
        return !suggestions.isEmpty();
    }

    public double getEstimatedImprovement() {
        return suggestions.stream()
                .mapToDouble(ThreadPoolSuggestion::getExpectedImprovement)
                .sum();
    }
}

class ThreadPoolSuggestion {
    private final Type type;
    private final String description;
    private final Object value;
    private final double expectedImprovement;

    public ThreadPoolSuggestion(Type type, String description, Object value) {
        this(type, description, value, calculateExpectedImprovement(type));
    }

    public ThreadPoolSuggestion(Type type, String description, Object value, double expectedImprovement) {
        this.type = type;
        this.description = description;
        this.value = value;
        this.expectedImprovement = expectedImprovement;
    }

    public Type getType() {
        return type;
    }

    public String getDescription() {
        return description;
    }

    public Object getValue() {
        return value;
    }

    public double getExpectedImprovement() {
        return expectedImprovement;
    }

    private static double calculateExpectedImprovement(Type type) {
        switch (type) {
            case INCREASE_POOL_SIZE:
                return 0.3;
            case ADJUST_QUEUE_SIZE:
                return 0.2;
            case OPTIMIZE_TASK:
                return 0.4;
            default:
                return 0.0;
        }
    }

    public enum Type {
        INCREASE_POOL_SIZE,
        ADJUST_QUEUE_SIZE,
        OPTIMIZE_TASK
    }

    @Override
    public String toString() {
        return String.format("%s: %s (Expected improvement: %.2f%%)",
                type, description, expectedImprovement * 100);
    }
} 