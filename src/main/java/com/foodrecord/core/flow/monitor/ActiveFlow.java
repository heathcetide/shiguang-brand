package com.foodrecord.core.flow.monitor;

public class ActiveFlow {
    private String flowId;
    private String status;
    private long startTime;
    private long duration;
    private int completedNodes;
    private int totalNodes;

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public long getStartTime() {
        return startTime;
    }

    public void setStartTime(long startTime) {
        this.startTime = startTime;
    }

    public long getDuration() {
        return duration;
    }

    public void setDuration(long duration) {
        this.duration = duration;
    }

    public int getCompletedNodes() {
        return completedNodes;
    }

    public void setCompletedNodes(int completedNodes) {
        this.completedNodes = completedNodes;
    }

    public int getTotalNodes() {
        return totalNodes;
    }

    public void setTotalNodes(int totalNodes) {
        this.totalNodes = totalNodes;
    }
} 