package com.foodrecord.core.flow.monitor;

import com.foodrecord.core.db.health.DataSourceAlert.AlertSeverity;
import com.foodrecord.core.db.health.FailoverRecommendation;
import org.springframework.boot.actuate.metrics.r2dbc.ConnectionPoolMetrics;
import com.foodrecord.core.db.health.QueryPerformanceMetrics;
import com.foodrecord.core.db.health.ResourceUtilization;
import java.util.List;

public class HealthStatus {
    private final ConnectionPoolMetrics poolMetrics;
    private final QueryPerformanceMetrics queryMetrics;
    private final ResourceUtilization resourceUtilization;
    private final List<HealthIssue> issues;
    private final FailoverRecommendation failoverRecommendation;

    public HealthStatus(
            ConnectionPoolMetrics poolMetrics,
            QueryPerformanceMetrics queryMetrics,
            ResourceUtilization resourceUtilization,
            List<HealthIssue> issues,
            FailoverRecommendation failoverRecommendation) {
        this.poolMetrics = poolMetrics;
        this.queryMetrics = queryMetrics;
        this.resourceUtilization = resourceUtilization;
        this.issues = issues;
        this.failoverRecommendation = failoverRecommendation;
    }

    public boolean isHealthy() {
        return issues.isEmpty() && !failoverRecommendation.shouldFailover();
    }

    public boolean isRecoverable() {
        return !issues.isEmpty() && issues.stream()
            .allMatch(issue -> issue.getSeverity().isLowerThan(3));
    }

    public boolean requiresFailover() {
        return failoverRecommendation.shouldFailover();
    }

    public AlertSeverity getSeverity() {
        if (requiresFailover()) {
            return AlertSeverity.CRITICAL;
        }
        if (!isHealthy()) {
            return AlertSeverity.WARNING;
        }
        return AlertSeverity.INFO;
    }

    public ConnectionPoolMetrics getPoolMetrics() {
        return poolMetrics;
    }

    public QueryPerformanceMetrics getQueryMetrics() {
        return queryMetrics;
    }

    public ResourceUtilization getResourceUtilization() {
        return resourceUtilization;
    }

    public List<HealthIssue> getIssues() {
        return issues;
    }

    public FailoverRecommendation getFailoverRecommendation() {
        return failoverRecommendation;
    }
} 