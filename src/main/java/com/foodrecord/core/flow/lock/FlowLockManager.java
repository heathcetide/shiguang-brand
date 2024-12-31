package com.foodrecord.core.flow.lock;

import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class FlowLockManager {
    private final Map<String, String> flowLocks = new ConcurrentHashMap<>();

    public boolean acquireLock(String flowId, String executionId) {
        return flowLocks.putIfAbsent(flowId, executionId) == null;
    }

    public void releaseLock(String flowId, String executionId) {
        flowLocks.remove(flowId, executionId);
    }

    public boolean isLocked(String flowId) {
        return flowLocks.containsKey(flowId);
    }

    public String getLockHolder(String flowId) {
        return flowLocks.get(flowId);
    }

    public void forceReleaseLock(String flowId) {
        flowLocks.remove(flowId);
    }

    public boolean isLockedBy(String flowId, String executionId) {
        return executionId.equals(flowLocks.get(flowId));
    }
} 