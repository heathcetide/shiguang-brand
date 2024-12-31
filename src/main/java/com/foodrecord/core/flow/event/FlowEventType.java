package com.foodrecord.core.flow.event;

public enum FlowEventType {
    FLOW_STARTED,
    FLOW_COMPLETED,
    FLOW_FAILED,
    NODE_STARTED,
    NODE_COMPLETED,
    NODE_FAILED,
    NODE_SKIPPED,
    FLOW_PAUSED,
    FLOW_RESUMED,
    FLOW_CANCELLED
} 