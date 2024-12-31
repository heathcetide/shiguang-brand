package com.foodrecord.core.flow.history;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;


public class FlowExecutionHistory {
    private String flowId;
    private String executionId;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private FlowExecutionStatus status;
    private List<NodeExecutionRecord> nodeRecords = new ArrayList<>();
    private Map<String, Object> variables;
    private String errorMessage;

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public String getExecutionId() {
        return executionId;
    }

    public void setExecutionId(String executionId) {
        this.executionId = executionId;
    }

    public LocalDateTime getStartTime() {
        return startTime;
    }

    public void setStartTime(LocalDateTime startTime) {
        this.startTime = startTime;
    }

    public LocalDateTime getEndTime() {
        return endTime;
    }

    public void setEndTime(LocalDateTime endTime) {
        this.endTime = endTime;
    }

    public FlowExecutionStatus getStatus() {
        return status;
    }

    public void setStatus(FlowExecutionStatus status) {
        this.status = status;
    }

    public List<NodeExecutionRecord> getNodeRecords() {
        return nodeRecords;
    }

    public void setNodeRecords(List<NodeExecutionRecord> nodeRecords) {
        this.nodeRecords = nodeRecords;
    }

    public Map<String, Object> getVariables() {
        return variables;
    }

    public void setVariables(Map<String, Object> variables) {
        this.variables = variables;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }
}