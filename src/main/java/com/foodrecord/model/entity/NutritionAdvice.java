package com.foodrecord.model.entity;

import java.util.List;
import java.util.Map;

/**
 * 营养建议
 * 包含各种营养相关的建议和警告
 */
public class NutritionAdvice extends BaseEntity{

    // 主键ID
    private Long id;

    // 用户ID
    private Long userId;

    // 营养素建议
    private Map<String, NutrientAdvice> nutrientAdvices;
    
    // 食物选择建议
    private List<FoodChoiceAdvice> foodChoiceAdvices;
    
    // 饮食习惯建议
    private List<DietaryHabitAdvice> habitAdvices;
    
    // 健康警告
    private List<HealthWarning> healthWarnings;
    
    // 总体评分
    private double overallScore;
    
    // 改进建议
    private String improvementSuggestions;

    public Map<String, NutrientAdvice> getNutrientAdvices() {
        return nutrientAdvices;
    }

    public void setNutrientAdvices(Map<String, NutrientAdvice> nutrientAdvices) {
        this.nutrientAdvices = nutrientAdvices;
    }

    public List<FoodChoiceAdvice> getFoodChoiceAdvices() {
        return foodChoiceAdvices;
    }

    public void setFoodChoiceAdvices(List<FoodChoiceAdvice> foodChoiceAdvices) {
        this.foodChoiceAdvices = foodChoiceAdvices;
    }

    public List<DietaryHabitAdvice> getHabitAdvices() {
        return habitAdvices;
    }

    public void setHabitAdvices(List<DietaryHabitAdvice> habitAdvices) {
        this.habitAdvices = habitAdvices;
    }

    public List<HealthWarning> getHealthWarnings() {
        return healthWarnings;
    }

    public void setHealthWarnings(List<HealthWarning> healthWarnings) {
        this.healthWarnings = healthWarnings;
    }

    public double getOverallScore() {
        return overallScore;
    }

    public void setOverallScore(double overallScore) {
        this.overallScore = overallScore;
    }

    public String getImprovementSuggestions() {
        return improvementSuggestions;
    }

    public void setImprovementSuggestions(String improvementSuggestions) {
        this.improvementSuggestions = improvementSuggestions;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }
}