package com.foodrecord.ml.feature;

import java.util.List;

public class UserFeature {
    private Long userId;
    private Integer age;
    private String gender;
    private Float bmi;
    private Float bloodPressure;
    private Float bloodSugar;
    private Integer activityLevel;
    // 其他用户特征
    private Float avgCaloryIntake; // 平均卡路里摄入
    private String preferredMealTime; // 首选用餐时间
    private List<String> favoriteCategories; // 最喜欢的食物类别
    private double[] featureArray;


    public Float getAvgCaloryIntake() {
        return avgCaloryIntake;
    }

    public void setAvgCaloryIntake(Float avgCaloryIntake) {
        this.avgCaloryIntake = avgCaloryIntake;
    }

    public String getPreferredMealTime() {
        return preferredMealTime;
    }

    public void setPreferredMealTime(String preferredMealTime) {
        this.preferredMealTime = preferredMealTime;
    }

    public List<String> getFavoriteCategories() {
        return favoriteCategories;
    }

    public void setFavoriteCategories(List<String> favoriteCategories) {
        this.favoriteCategories = favoriteCategories;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Integer getAge() {
        return age;
    }

    public void setAge(Integer age) {
        this.age = age;
    }

    public String getGender() {
        return gender;
    }

    public void setGender(String gender) {
        this.gender = gender;
    }

    public Float getBmi() {
        return bmi;
    }

    public void setBmi(Float bmi) {
        this.bmi = bmi;
    }

    public Float getBloodPressure() {
        return bloodPressure;
    }

    public void setBloodPressure(Float bloodPressure) {
        this.bloodPressure = bloodPressure;
    }

    public Float getBloodSugar() {
        return bloodSugar;
    }

    public void setBloodSugar(Float bloodSugar) {
        this.bloodSugar = bloodSugar;
    }

    public Integer getActivityLevel() {
        return activityLevel;
    }

    public void setActivityLevel(Integer activityLevel) {
        this.activityLevel = activityLevel;
    }

    public double[] getFeatureArray() {
        return featureArray;
    }

    public void setFeatureArray(double[] featureArray) {
        this.featureArray = featureArray;
    }
}