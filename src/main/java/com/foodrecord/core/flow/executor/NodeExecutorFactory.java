package com.foodrecord.core.flow.executor;

import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class NodeExecutorFactory {
    private final Map<String, NodeExecutor> executors = new ConcurrentHashMap<>();
    
    public void registerExecutor(String nodeType, NodeExecutor executor) {
        executors.put(nodeType, executor);
    }
    
    public NodeExecutor getExecutor(String nodeType) {
        NodeExecutor executor = executors.get(nodeType);
        if (executor == null) {
            throw new IllegalArgumentException("No executor found for node type: " + nodeType);
        }
        return executor;
    }
} 