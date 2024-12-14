package com.foodrecord.model.entity;


/**
 * 饮食习惯建议
 */

public class DietaryHabitAdvice {
    // 习惯类型
    private String habitType;
    
    // 当前状况
    private String currentStatus;
    
    // 目标状况
    private String targetStatus;
    
    // 改进建议
    private String improvementSuggestion;
    
    // 预期效果
    private String expectedOutcome;

    public String getHabitType() {
        return habitType;
    }

    public void setHabitType(String habitType) {
        this.habitType = habitType;
    }

    public String getCurrentStatus() {
        return currentStatus;
    }

    public void setCurrentStatus(String currentStatus) {
        this.currentStatus = currentStatus;
    }

    public String getTargetStatus() {
        return targetStatus;
    }

    public void setTargetStatus(String targetStatus) {
        this.targetStatus = targetStatus;
    }

    public String getImprovementSuggestion() {
        return improvementSuggestion;
    }

    public void setImprovementSuggestion(String improvementSuggestion) {
        this.improvementSuggestion = improvementSuggestion;
    }

    public String getExpectedOutcome() {
        return expectedOutcome;
    }

    public void setExpectedOutcome(String expectedOutcome) {
        this.expectedOutcome = expectedOutcome;
    }
}