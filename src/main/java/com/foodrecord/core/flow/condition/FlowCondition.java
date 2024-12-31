package com.foodrecord.core.flow.condition;

import java.util.Map;

public interface FlowCondition {
    boolean evaluate(Map<String, Object> context);
    String getExpression();
} 