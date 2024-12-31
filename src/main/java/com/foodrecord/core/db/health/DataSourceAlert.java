package com.foodrecord.core.db.health;

import com.foodrecord.core.flow.alert.Alert;
import com.foodrecord.core.flow.monitor.HealthStatus;
import com.foodrecord.core.logging.Severity;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public class DataSourceAlert {
    private final String alertId;
    private final AlertSeverity severity;
    private final String message;
    private final LocalDateTime timestamp;
    private final Map<String, Object> details;
    private final List<String> recommendations;

    public DataSourceAlert(String alertId, AlertSeverity severity, String message,
                         LocalDateTime timestamp, Map<String, Object> details,
                         List<String> recommendations) {
        this.alertId = alertId;
        this.severity = severity;
        this.message = message;
        this.timestamp = timestamp;
        this.details = details;
        this.recommendations = recommendations;
    }

    public DataSourceAlert(HealthStatus status) {
        this.alertId = generateAlertId();
        this.severity = determineSeverity(status);
        this.message = generateMessage(status);
        this.timestamp = LocalDateTime.now();
        this.details = collectDetails(status);
        this.recommendations = generateRecommendations(status);
    }

    private String generateAlertId() {
        return "ALERT-" + System.currentTimeMillis();
    }

    private AlertSeverity determineSeverity(HealthStatus status) {
        if (status.requiresFailover()) {
            return AlertSeverity.CRITICAL;
        }
        if (!status.isHealthy()) {
            return AlertSeverity.WARNING;
        }
        return AlertSeverity.INFO;
    }

    private String generateMessage(HealthStatus status) {
        return "Database health check failed: " + status.getIssues().size() + " issues found";
    }

    private Map<String, Object> collectDetails(HealthStatus status) {
        return Map.of(
            "queryMetrics", status.getQueryMetrics(),
            "resourceUtilization", status.getResourceUtilization(),
            "issues", status.getIssues()
        );
    }

    private List<String> generateRecommendations(HealthStatus status) {
        return List.of(
            "Check database connection settings",
            "Monitor resource utilization",
            "Review query performance"
        );
    }

    public String getAlertId() {
        return alertId;
    }

    public AlertSeverity getSeverity() {
        return severity;
    }

    public String getMessage() {
        return message;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public Map<String, Object> getDetails() {
        return details;
    }

    public List<String> getRecommendations() {
        return recommendations;
    }

    public enum AlertSeverity {
        INFO,
        WARNING,
        CRITICAL,
        EMERGENCY;

        public boolean isHigherThan(AlertSeverity other) {
            return this.ordinal() > other.ordinal();
        }
    }
} 