package com.foodrecord.core.logging;

import java.util.List;
import java.util.Map;

public class MitigationStrategy {
    private final String strategyId;
    private final String name;
    private final String description;
    private final Priority priority;
    private final List<String> steps;
    private final Map<String, Object> parameters;
    private final double estimatedEffectiveness;
    private final List<String> prerequisites;

    public MitigationStrategy(String strategyId, String name, String description,
                            Priority priority, List<String> steps,
                            Map<String, Object> parameters, double estimatedEffectiveness,
                            List<String> prerequisites) {
        this.strategyId = strategyId;
        this.name = name;
        this.description = description;
        this.priority = priority;
        this.steps = steps;
        this.parameters = parameters;
        this.estimatedEffectiveness = estimatedEffectiveness;
        this.prerequisites = prerequisites;
    }

    public String getStrategyId() {
        return strategyId;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public Priority getPriority() {
        return priority;
    }

    public List<String> getSteps() {
        return steps;
    }

    public Map<String, Object> getParameters() {
        return parameters;
    }

    public double getEstimatedEffectiveness() {
        return estimatedEffectiveness;
    }

    public List<String> getPrerequisites() {
        return prerequisites;
    }

    public enum Priority {
        IMMEDIATE,
        HIGH,
        MEDIUM,
        LOW
    }
} 