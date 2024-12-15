package com.foodrecord.model.entity;

import java.time.LocalTime;
import java.util.List;
import java.util.Map;

/**
 * 饮食偏好
 * 记录用户的饮食习惯和偏好
 */
public class DietaryPreferences {
    // 常吃食物及其频率
    private Map<Long, Integer> favoriteFoods;
    
    // 营养素摄入趋势
    private Map<String, Double> nutritionTrends;
    
    // 用餐时间规律 (小时 -> 时间列表)
    private Map<Integer, List<LocalTime>> mealTimePatterns;
    
    // 食物类型偏好
    private Map<String, Double> foodTypePreferences;
    
    // 口味偏好
    private Map<String, Double> tastePreferences;
    
    // 忌口食物
    private List<Long> avoidFoods;
    
    // 过敏食物
    private List<Long> allergyFoods;

    public Map<Long, Integer> getFavoriteFoods() {
        return favoriteFoods;
    }

    public void setFavoriteFoods(Map<Long, Integer> favoriteFoods) {
        this.favoriteFoods = favoriteFoods;
    }

    public Map<String, Double> getNutritionTrends() {
        return nutritionTrends;
    }

    public void setNutritionTrends(Map<String, Double> nutritionTrends) {
        this.nutritionTrends = nutritionTrends;
    }

    public Map<Integer, List<LocalTime>> getMealTimePatterns() {
        return mealTimePatterns;
    }

    public void setMealTimePatterns(Map<Integer, List<LocalTime>> mealTimePatterns) {
        this.mealTimePatterns = mealTimePatterns;
    }

    public Map<String, Double> getFoodTypePreferences() {
        return foodTypePreferences;
    }

    public void setFoodTypePreferences(Map<String, Double> foodTypePreferences) {
        this.foodTypePreferences = foodTypePreferences;
    }

    public Map<String, Double> getTastePreferences() {
        return tastePreferences;
    }

    public void setTastePreferences(Map<String, Double> tastePreferences) {
        this.tastePreferences = tastePreferences;
    }

    public List<Long> getAvoidFoods() {
        return avoidFoods;
    }

    public void setAvoidFoods(List<Long> avoidFoods) {
        this.avoidFoods = avoidFoods;
    }

    public List<Long> getAllergyFoods() {
        return allergyFoods;
    }

    public void setAllergyFoods(List<Long> allergyFoods) {
        this.allergyFoods = allergyFoods;
    }
}