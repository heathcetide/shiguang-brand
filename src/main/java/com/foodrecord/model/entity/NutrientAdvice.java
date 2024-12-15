package com.foodrecord.model.entity;

import java.util.List;

/**
 * 营养素建议
 */
public class NutrientAdvice {
    // 营养素名称
    private String nutrientName;
    
    // 当前摄入量
    private double currentIntake;
    
    // 目标摄入量
    private double targetIntake;
    
    // 差异百分比
    private double deviation;
    
    // 建议
    private String suggestion;
    
    // 推荐食物
    private List<Food> recommendedFoods;

    public String getNutrientName() {
        return nutrientName;
    }

    public void setNutrientName(String nutrientName) {
        this.nutrientName = nutrientName;
    }

    public double getCurrentIntake() {
        return currentIntake;
    }

    public void setCurrentIntake(double currentIntake) {
        this.currentIntake = currentIntake;
    }

    public double getTargetIntake() {
        return targetIntake;
    }

    public void setTargetIntake(double targetIntake) {
        this.targetIntake = targetIntake;
    }

    public double getDeviation() {
        return deviation;
    }

    public void setDeviation(double deviation) {
        this.deviation = deviation;
    }

    public String getSuggestion() {
        return suggestion;
    }

    public void setSuggestion(String suggestion) {
        this.suggestion = suggestion;
    }

    public List<Food> getRecommendedFoods() {
        return recommendedFoods;
    }

    public void setRecommendedFoods(List<Food> recommendedFoods) {
        this.recommendedFoods = recommendedFoods;
    }
}