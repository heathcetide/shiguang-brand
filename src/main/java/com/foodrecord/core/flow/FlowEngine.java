package com.foodrecord.core.flow;

import com.foodrecord.core.flow.model.FlowNode;
import java.util.List;
import java.util.Map;

public interface FlowEngine {
    void registerFlow(String flowId, List<FlowNode> nodes);
    void executeFlow(String flowId, Map<String, Object> context);
    void stopFlow(String flowId);
    void pauseFlow(String flowId);
    void resumeFlow(String flowId);
    boolean isFlowRunning(String flowId);
    Map<String, Object> getFlowStatus(String flowId);
} 