package com.foodrecord.core.flow.event;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.HashMap;

public class FlowEvent {
    private String flowId;
    private String executionId;
    private String nodeId;
    private FlowEventType eventType;
    private LocalDateTime timestamp;
    private Map<String, Object> data;
    
    public static FlowEvent of(String flowId, String executionId, 
                              String nodeId, FlowEventType type) {
        FlowEvent event = new FlowEvent();
        event.setFlowId(flowId);
        event.setExecutionId(executionId);
        event.setNodeId(nodeId);
        event.setEventType(type);
        event.setTimestamp(LocalDateTime.now());
        event.setData(new HashMap<>());
        return event;
    }

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

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public FlowEventType getEventType() {
        return eventType;
    }

    public void setEventType(FlowEventType eventType) {
        this.eventType = eventType;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public Map<String, Object> getData() {
        return data;
    }

    public void setData(Map<String, Object> data) {
        this.data = data;
    }

    public void addData(String key, Object value) {
        if (this.data == null) {
            this.data = new HashMap<>();
        }
        this.data.put(key, value);
    }
} 