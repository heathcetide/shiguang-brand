package com.foodrecord.core.flow.analytics;

import java.util.Map;
import java.util.HashMap;

public class NodeExecutionPattern {
    private String nodeId;
    private double inputOutputCorrelation;
    private double executionFrequency;
    private Map<String, Double> inputPatterns;
    private Map<String, Double> outputPatterns;
    private boolean hasCachingPotential;

    public NodeExecutionPattern() {
        this.inputPatterns = new HashMap<>();
        this.outputPatterns = new HashMap<>();
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public double getInputOutputCorrelation() {
        return inputOutputCorrelation;
    }

    public void setInputOutputCorrelation(double inputOutputCorrelation) {
        this.inputOutputCorrelation = inputOutputCorrelation;
    }

    public double getExecutionFrequency() {
        return executionFrequency;
    }

    public void setExecutionFrequency(double executionFrequency) {
        this.executionFrequency = executionFrequency;
    }

    public Map<String, Double> getInputPatterns() {
        return inputPatterns;
    }

    public void setInputPatterns(Map<String, Double> inputPatterns) {
        this.inputPatterns = inputPatterns;
    }

    public Map<String, Double> getOutputPatterns() {
        return outputPatterns;
    }

    public void setOutputPatterns(Map<String, Double> outputPatterns) {
        this.outputPatterns = outputPatterns;
    }

    public boolean isHasCachingPotential() {
        return hasCachingPotential;
    }

    public void setHasCachingPotential(boolean hasCachingPotential) {
        this.hasCachingPotential = hasCachingPotential;
    }
} 