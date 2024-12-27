package com.foodrecord.risk.model;


import com.foodrecord.risk.enums.RiskAction;

public class RiskRule {
    private String id;
    private String name;
    private String scenario;
    private String condition;
    private double score;
    private RiskAction action;
    private long limitDuration;
    private boolean enabled;

    public boolean evaluate(RiskContext context) {
        // TODO: 实现规则评估逻辑
        return false;
    }

    // Getters and setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getScenario() {
        return scenario;
    }

    public void setScenario(String scenario) {
        this.scenario = scenario;
    }

    public String getCondition() {
        return condition;
    }

    public void setCondition(String condition) {
        this.condition = condition;
    }

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
    }

    public RiskAction getAction() {
        return action;
    }

    public void setAction(RiskAction action) {
        this.action = action;
    }

    public long getLimitDuration() {
        return limitDuration;
    }

    public void setLimitDuration(long limitDuration) {
        this.limitDuration = limitDuration;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
} 