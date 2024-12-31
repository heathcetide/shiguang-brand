package com.foodrecord.core.flow.executor;

import com.foodrecord.core.flow.model.FlowNode;
import java.util.Map;

public interface NodeExecutor {
    void execute(FlowNode node, Map<String, Object> context);
    boolean canExecute(FlowNode node);
} 