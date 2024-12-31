package com.foodrecord.core.flow.predictor;

import org.deeplearning4j.common.resources.ResourceType;
import java.time.LocalDateTime;
import java.util.*;

public class PredictionReport {
    private String flowId;
    private LocalDateTime targetTime;
    private double predictedExecutionTime;
    private double confidenceLevel;
    private Map<ResourceType, Double> predictedResourceUsage;
    private List<PotentialIssue> potentialIssues;

    public PredictionReport() {
        this.predictedResourceUsage = new EnumMap<>(ResourceType.class);
        this.potentialIssues = new ArrayList<>();
    }

    public static class PotentialIssue {
        private IssueType type;
        private String description;
        private double probability;

        public PotentialIssue(IssueType type, String description, double probability) {
            this.type = type;
            this.description = description;
            this.probability = probability;
        }

        public IssueType getType() {
            return type;
        }

        public void setType(IssueType type) {
            this.type = type;
        }

        public String getDescription() {
            return description;
        }

        public void setDescription(String description) {
            this.description = description;
        }

        public double getProbability() {
            return probability;
        }

        public void setProbability(double probability) {
            this.probability = probability;
        }
    }

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public LocalDateTime getTargetTime() {
        return targetTime;
    }

    public void setTargetTime(LocalDateTime targetTime) {
        this.targetTime = targetTime;
    }

    public double getPredictedExecutionTime() {
        return predictedExecutionTime;
    }

    public void setPredictedExecutionTime(double predictedExecutionTime) {
        this.predictedExecutionTime = predictedExecutionTime;
    }

    public double getConfidenceLevel() {
        return confidenceLevel;
    }

    public void setConfidenceLevel(double confidenceLevel) {
        this.confidenceLevel = confidenceLevel;
    }

    public Map<ResourceType, Double> getPredictedResourceUsage() {
        return predictedResourceUsage;
    }

    public void setPredictedResourceUsage(Map<ResourceType, Double> predictedResourceUsage) {
        this.predictedResourceUsage = predictedResourceUsage;
    }

    public List<PotentialIssue> getPotentialIssues() {
        return potentialIssues;
    }

    public void setPotentialIssues(List<PotentialIssue> potentialIssues) {
        this.potentialIssues = potentialIssues;
    }
}