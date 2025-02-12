package com.foodrecord.common.risk.model;


import com.foodrecord.risk.enums.RiskLevel;

import java.util.List;

public class RiskEvent {
    private RiskContext context;
    private double score;
    private RiskLevel level;
    private List<RiskViolation> violations;
    private long timestamp;

    public RiskEvent(RiskContext context, double score, RiskLevel level, 
                    List<RiskViolation> violations, long timestamp) {
        this.context = context;
        this.score = score;
        this.level = level;
        this.violations = violations;
        this.timestamp = timestamp;
    }

    // Getters and setters
    public RiskContext getContext() {
        return context;
    }

    public void setContext(RiskContext context) {
        this.context = context;
    }

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
    }

    public RiskLevel getLevel() {
        return level;
    }

    public void setLevel(RiskLevel level) {
        this.level = level;
    }

    public List<RiskViolation> getViolations() {
        return violations;
    }

    public void setViolations(List<RiskViolation> violations) {
        this.violations = violations;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }
} 