package com.foodrecord.core.flow.performance;

import java.util.List;
import java.util.Map;

public class PerformanceReport {
    private String flowId;
    private Map<String, NodePerformanceStats> nodeStats;
    private List<String> bottlenecks;



    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public Map<String, NodePerformanceStats> getNodeStats() {
        return nodeStats;
    }

    public void setNodeStats(Map<String, NodePerformanceStats> nodeStats) {
        this.nodeStats = nodeStats;
    }

    public List<String> getBottlenecks() {
        return bottlenecks;
    }

    public void setBottlenecks(List<String> bottlenecks) {
        this.bottlenecks = bottlenecks;
    }
} 