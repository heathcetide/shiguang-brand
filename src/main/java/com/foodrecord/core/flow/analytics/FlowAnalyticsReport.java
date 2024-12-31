package com.foodrecord.core.flow.analytics;

import java.util.List;

public class FlowAnalyticsReport {
    private String flowId;
    private DateRange period;
    private ExecutionStats stats;
    private List<TrendPoint> executionTrend;
    private List<Anomaly> anomalies;

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public DateRange getPeriod() {
        return period;
    }

    public void setPeriod(DateRange period) {
        this.period = period;
    }

    public ExecutionStats getStats() {
        return stats;
    }

    public void setStats(ExecutionStats stats) {
        this.stats = stats;
    }

    public List<TrendPoint> getExecutionTrend() {
        return executionTrend;
    }

    public void setExecutionTrend(List<TrendPoint> executionTrend) {
        this.executionTrend = executionTrend;
    }

    public List<Anomaly> getAnomalies() {
        return anomalies;
    }

    public void setAnomalies(List<Anomaly> anomalies) {
        this.anomalies = anomalies;
    }
} 