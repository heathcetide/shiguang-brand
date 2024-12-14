package com.foodrecord.model.dto;


/**
 * 营养素查询条件
 */
public class NutritionCriteria {
    // 营养素名称
    private String nutrient;
    
    // 最小值
    private Double minValue;
    
    // 最大值
    private Double maxValue;

    public String getNutrient() {
        return nutrient;
    }

    public void setNutrient(String nutrient) {
        this.nutrient = nutrient;
    }

    public Double getMinValue() {
        return minValue;
    }

    public void setMinValue(Double minValue) {
        this.minValue = minValue;
    }

    public Double getMaxValue() {
        return maxValue;
    }

    public void setMaxValue(Double maxValue) {
        this.maxValue = maxValue;
    }
}