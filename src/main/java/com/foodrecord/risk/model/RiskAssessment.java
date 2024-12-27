package com.foodrecord.risk.model;

import com.foodrecord.risk.enums.RiskLevel;

import java.util.List;

public class RiskAssessment {
    private double score;
    private RiskLevel level;
    private List<RiskViolation> violations;

    public RiskAssessment(double score, RiskLevel level, List<RiskViolation> violations) {
        this.score = score;
        this.level = level;
        this.violations = violations;
    }

    // Getters and setters
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
} 