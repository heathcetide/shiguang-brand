package com.foodrecord.core.flow.optimizer;

import java.time.LocalDateTime;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import com.foodrecord.core.flow.performance.PerformanceMetrics;

public class OptimizationReport {
    private String flowId;
    private LocalDateTime generatedTime;
    private List<OptimizationSuggestion> suggestions = new ArrayList<>();
    private Map<String, PerformanceMetrics> nodeMetrics;
    private ResourceUsageAnalysis resourceAnalysis;

    public void addSuggestion(OptimizationSuggestion suggestion) {
        if (suggestions == null) {
            suggestions = new ArrayList<>();
        }
        suggestions.add(suggestion);
    }

    public void addSuggestions(List<OptimizationSuggestion> newSuggestions) {
        if (suggestions == null) {
            suggestions = new ArrayList<>();
        }
        suggestions.addAll(newSuggestions);
    }

    public static class OptimizationSuggestion {
        private OptimizationType type;
        private String description;
        private List<String> actionItems;
        private double expectedImprovement;
        private Priority priority;
        
        public OptimizationSuggestion(OptimizationType type, String description, List<String> actionItems) {
            this.type = type;
            this.description = description;
            this.actionItems = actionItems;
            this.priority = Priority.MEDIUM;
        }
        
        public enum Priority {
            LOW, MEDIUM, HIGH, CRITICAL
        }

        public OptimizationType getType() {
            return type;
        }

        public void setType(OptimizationType type) {
            this.type = type;
        }

        public String getDescription() {
            return description;
        }

        public void setDescription(String description) {
            this.description = description;
        }

        public List<String> getActionItems() {
            return actionItems;
        }

        public void setActionItems(List<String> actionItems) {
            this.actionItems = actionItems;
        }

        public double getExpectedImprovement() {
            return expectedImprovement;
        }

        public void setExpectedImprovement(double expectedImprovement) {
            this.expectedImprovement = expectedImprovement;
        }

        public Priority getPriority() {
            return priority;
        }

        public void setPriority(Priority priority) {
            this.priority = priority;
        }
    }

    public static class ResourceUsageAnalysis {
        private double cpuEfficiency;
        private double memoryEfficiency;
        private double threadPoolUtilization;
        private List<ResourceBottleneck> bottlenecks;

        public double getCpuEfficiency() {
            return cpuEfficiency;
        }

        public void setCpuEfficiency(double cpuEfficiency) {
            this.cpuEfficiency = cpuEfficiency;
        }

        public double getMemoryEfficiency() {
            return memoryEfficiency;
        }

        public void setMemoryEfficiency(double memoryEfficiency) {
            this.memoryEfficiency = memoryEfficiency;
        }

        public double getThreadPoolUtilization() {
            return threadPoolUtilization;
        }

        public void setThreadPoolUtilization(double threadPoolUtilization) {
            this.threadPoolUtilization = threadPoolUtilization;
        }

        public List<ResourceBottleneck> getBottlenecks() {
            return bottlenecks;
        }

        public void setBottlenecks(List<ResourceBottleneck> bottlenecks) {
            this.bottlenecks = bottlenecks;
        }
    }

    public static class ResourceBottleneck {
        private String resource;
        private double utilizationRate;
        private String impact;
        private List<String> optimizationSuggestions;

        public String getResource() {
            return resource;
        }

        public void setResource(String resource) {
            this.resource = resource;
        }

        public double getUtilizationRate() {
            return utilizationRate;
        }

        public void setUtilizationRate(double utilizationRate) {
            this.utilizationRate = utilizationRate;
        }

        public String getImpact() {
            return impact;
        }

        public void setImpact(String impact) {
            this.impact = impact;
        }

        public List<String> getOptimizationSuggestions() {
            return optimizationSuggestions;
        }

        public void setOptimizationSuggestions(List<String> optimizationSuggestions) {
            this.optimizationSuggestions = optimizationSuggestions;
        }
    }

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public LocalDateTime getGeneratedTime() {
        return generatedTime;
    }

    public void setGeneratedTime(LocalDateTime generatedTime) {
        this.generatedTime = generatedTime;
    }

    public List<OptimizationSuggestion> getSuggestions() {
        return suggestions;
    }

    public void setSuggestions(List<OptimizationSuggestion> suggestions) {
        this.suggestions = suggestions;
    }

    public Map<String, PerformanceMetrics> getNodeMetrics() {
        return nodeMetrics;
    }

    public void setNodeMetrics(Map<String, PerformanceMetrics> nodeMetrics) {
        this.nodeMetrics = nodeMetrics;
    }

    public ResourceUsageAnalysis getResourceAnalysis() {
        return resourceAnalysis;
    }

    public void setResourceAnalysis(ResourceUsageAnalysis resourceAnalysis) {
        this.resourceAnalysis = resourceAnalysis;
    }
}