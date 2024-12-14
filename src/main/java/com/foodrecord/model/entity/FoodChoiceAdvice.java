package com.foodrecord.model.entity;

import java.util.List;

/**
 * 食物选择建议
 */
public class FoodChoiceAdvice {
    // 食物类别
    private String foodCategory;
    
    // 建议增加的食物
    private List<Food> increaseChoices;
    
    // 建议减少的食物
    private List<Food> decreaseChoices;
    
    // 建议原因
    private String reason;
    
    // 具体建议
    private String suggestion;

    public String getFoodCategory() {
        return foodCategory;
    }

    public void setFoodCategory(String foodCategory) {
        this.foodCategory = foodCategory;
    }

    public List<Food> getIncreaseChoices() {
        return increaseChoices;
    }

    public void setIncreaseChoices(List<Food> increaseChoices) {
        this.increaseChoices = increaseChoices;
    }

    public List<Food> getDecreaseChoices() {
        return decreaseChoices;
    }

    public void setDecreaseChoices(List<Food> decreaseChoices) {
        this.decreaseChoices = decreaseChoices;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    public String getSuggestion() {
        return suggestion;
    }

    public void setSuggestion(String suggestion) {
        this.suggestion = suggestion;
    }
}