package com.foodrecord.core.logging;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class RootCauseAnalyzer {
    
    public RootCauseAnalysis analyze(List<RecognizedPattern> patterns, AnomalyScore anomalyScore) {
        List<CauseFactor> factors = analyzeFactors(patterns, anomalyScore);
        return new RootCauseAnalysis(factors, generateRemediationActions(factors));
    }
    
    private List<CauseFactor> analyzeFactors(List<RecognizedPattern> patterns, AnomalyScore anomalyScore) {
        List<CauseFactor> factors = new ArrayList<>();
        // 分析主要和次要因素
        for (RecognizedPattern pattern : patterns) {
            factors.add(new CauseFactor(
                pattern.getType(),
                pattern.getDescription(),
                calculateConfidence(pattern, anomalyScore),
                calculateWeight(pattern)
            ));
        }
        return factors;
    }
    
    private List<RemediationAction> generateRemediationActions(List<CauseFactor> factors) {
        List<RemediationAction> actions = new ArrayList<>();
        
        for (CauseFactor factor : factors) {
            Severity priority = determinePriority(factor);
            Set<String> targetServices = determineTargetServices(factor);
            
            actions.add(new RemediationAction(
                "Remediation for " + factor.getDescription(),
                priority,
                targetServices,
                estimateTimeToResolve(factor)
            ));
        }
        
        return actions;
    }
    
    private double calculateConfidence(RecognizedPattern pattern, AnomalyScore anomalyScore) {
        return pattern.getFrequency() * anomalyScore.getValue() / 100.0;
    }
    
    private double calculateWeight(RecognizedPattern pattern) {
        return pattern.getSeverity().getLevel() / 4.0;
    }
    
    private Severity determinePriority(CauseFactor factor) {
        if (factor.getConfidence() > 0.8) {
            return Severity.CRITICAL;
        } else if (factor.getConfidence() > 0.6) {
            return Severity.HIGH;
        } else if (factor.getConfidence() > 0.4) {
            return Severity.MEDIUM;
        }
        return Severity.LOW;
    }
    
    private Set<String> determineTargetServices(CauseFactor factor) {
        // 这里应该根据实际情况确定受影响的服务
        Set<String> services = new HashSet<>();
        services.add("default-service");
        return services;
    }
    
    private int estimateTimeToResolve(CauseFactor factor) {
        // 基于因素的置信度和权重估计解决时间
        if (factor.getConfidence() > 0.8) {
            return 30; // 紧急情况，需要立即处理
        } else if (factor.getConfidence() > 0.5) {
            return 60; // 重要问题，需要尽快处理
        }
        return 120; // 一般问题，可以稍后处理
    }
    
    public static class CauseFactor {
        private final String type;
        private final String description;
        private final double confidence;
        private final double weight;
        
        public CauseFactor(String type, String description, double confidence, double weight) {
            this.type = type;
            this.description = description;
            this.confidence = confidence;
            this.weight = weight;
        }
        
        public String getType() {
            return type;
        }
        
        public String getDescription() {
            return description;
        }
        
        public double getConfidence() {
            return confidence;
        }
        
        public double getWeight() {
            return weight;
        }
    }
    
    public static class RootCauseAnalysis {
        private final List<CauseFactor> factors;
        private final List<RemediationAction> actions;
        
        public RootCauseAnalysis(List<CauseFactor> factors, List<RemediationAction> actions) {
            this.factors = factors;
            this.actions = actions;
        }
        
        public List<CauseFactor> getFactors() {
            return factors;
        }
        
        public List<RemediationAction> getActions() {
            return actions;
        }
    }
} 