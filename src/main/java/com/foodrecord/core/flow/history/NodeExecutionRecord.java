package com.foodrecord.core.flow.history;

import java.time.LocalDateTime;
import java.util.Map;
public class NodeExecutionRecord {
    private String nodeId;
    private String nodeType;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private NodeExecutionStatus status;
    private Map<String, Object> inputVariables;
    private Map<String, Object> outputVariables;
    private String errorMessage;

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public String getNodeType() {
        return nodeType;
    }

    public void setNodeType(String nodeType) {
        this.nodeType = nodeType;
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

    public NodeExecutionStatus getStatus() {
        return status;
    }

    public void setStatus(NodeExecutionStatus status) {
        this.status = status;
    }

    public Map<String, Object> getInputVariables() {
        return inputVariables;
    }

    public void setInputVariables(Map<String, Object> inputVariables) {
        this.inputVariables = inputVariables;
    }

    public Map<String, Object> getOutputVariables() {
        return outputVariables;
    }

    public void setOutputVariables(Map<String, Object> outputVariables) {
        this.outputVariables = outputVariables;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }
}