package com.foodrecord.core.flow.alert;

import java.time.Duration;

public class AlertRule {
    private String flowId;
    private String nodeId;
    private AlertType type;
    private AlertCondition condition;
    private double threshold;
    private Duration timeWindow;
    private AlertLevel level;
    private String notificationChannel;
    
    public enum AlertType {
        EXECUTION_TIME,
        ERROR_RATE,
        THROUGHPUT,
        MEMORY_USAGE
    }
    
    public enum AlertCondition {
        GREATER_THAN,
        LESS_THAN,
        EQUALS
    }
    
    public enum AlertLevel {
        INFO,
        WARNING,
        ERROR,
        CRITICAL
    }

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public AlertType getType() {
        return type;
    }

    public void setType(AlertType type) {
        this.type = type;
    }

    public AlertCondition getCondition() {
        return condition;
    }

    public void setCondition(AlertCondition condition) {
        this.condition = condition;
    }

    public double getThreshold() {
        return threshold;
    }

    public void setThreshold(double threshold) {
        this.threshold = threshold;
    }

    public Duration getTimeWindow() {
        return timeWindow;
    }

    public void setTimeWindow(Duration timeWindow) {
        this.timeWindow = timeWindow;
    }

    public AlertLevel getLevel() {
        return level;
    }

    public void setLevel(AlertLevel level) {
        this.level = level;
    }

    public String getNotificationChannel() {
        return notificationChannel;
    }

    public void setNotificationChannel(String notificationChannel) {
        this.notificationChannel = notificationChannel;
    }
}