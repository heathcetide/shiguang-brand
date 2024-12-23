package com.foodrecord.model.entity.user;


import com.foodrecord.model.entity.DietaryPreferences;

/**
 * 用户画像
 * 包含用户的健康数据、饮食目标和饮食偏好
 */

public class UserProfile {
    private UserHealthData healthData;
    private UserDietaryGoals dietaryGoals;
    private DietaryPreferences dietaryPreferences;

    public UserHealthData getHealthData() {
        return healthData;
    }

    public void setHealthData(UserHealthData healthData) {
        this.healthData = healthData;
    }

    public UserDietaryGoals getDietaryGoals() {
        return dietaryGoals;
    }

    public void setDietaryGoals(UserDietaryGoals dietaryGoals) {
        this.dietaryGoals = dietaryGoals;
    }

    public DietaryPreferences getDietaryPreferences() {
        return dietaryPreferences;
    }

    public void setDietaryPreferences(DietaryPreferences dietaryPreferences) {
        this.dietaryPreferences = dietaryPreferences;
    }
}