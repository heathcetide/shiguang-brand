package com.foodrecord.core.logging;

import java.util.List;
import java.util.Map;

public class AffectedComponent {
    private final String componentId;
    private final String componentName;
    private final ComponentType type;
    private final SeverityLevel impactSeverity;
    private final List<String> affectedServices;
    private final Map<String, Object> metrics;

    public AffectedComponent(String componentId, String componentName, ComponentType type,
                           SeverityLevel impactSeverity, List<String> affectedServices,
                           Map<String, Object> metrics) {
        this.componentId = componentId;
        this.componentName = componentName;
        this.type = type;
        this.impactSeverity = impactSeverity;
        this.affectedServices = affectedServices;
        this.metrics = metrics;
    }

    public String getComponentId() {
        return componentId;
    }

    public String getComponentName() {
        return componentName;
    }

    public ComponentType getType() {
        return type;
    }

    public SeverityLevel getImpactSeverity() {
        return impactSeverity;
    }

    public List<String> getAffectedServices() {
        return affectedServices;
    }

    public Map<String, Object> getMetrics() {
        return metrics;
    }

    public enum ComponentType {
        SERVICE,
        DATABASE,
        CACHE,
        QUEUE,
        API,
        UI,
        NETWORK,
        STORAGE
    }
} 