package com.foodrecord.ml.model;

import java.util.ArrayList;
import java.util.List;

public class UserHealthProfile {
    private double proteinGoal;    // 每日蛋白质目标 (克)
    private double fatGoal;        // 每日脂肪目标 (克)
    private double carbGoal;       // 每日碳水化合物目标 (克)
    private int dailyCalorieLimit; // 每日卡路里限制
    private boolean lactoseIntolerant; // 是否乳糖不耐症
    private boolean glutenIntolerant;  // 是否麸质不耐症
    private List<String> allergies;    // 用户过敏食材列表

    // 构造函数
    public UserHealthProfile() {
        this.allergies = new ArrayList<>(); // 初始化过敏列表
    }

    // Getter 和 Setter 方法
    public double getProteinGoal() {
        return proteinGoal;
    }

    public void setProteinGoal(double proteinGoal) {
        this.proteinGoal = proteinGoal;
    }

    public double getFatGoal() {
        return fatGoal;
    }

    public void setFatGoal(double fatGoal) {
        this.fatGoal = fatGoal;
    }

    public double getCarbGoal() {
        return carbGoal;
    }

    public void setCarbGoal(double carbGoal) {
        this.carbGoal = carbGoal;
    }

    public int getDailyCalorieLimit() {
        return dailyCalorieLimit;
    }

    public void setDailyCalorieLimit(int dailyCalorieLimit) {
        this.dailyCalorieLimit = dailyCalorieLimit;
    }

    public boolean isLactoseIntolerant() {
        return lactoseIntolerant;
    }

    public void setLactoseIntolerant(boolean lactoseIntolerant) {
        this.lactoseIntolerant = lactoseIntolerant;
    }

    public boolean isGlutenIntolerant() {
        return glutenIntolerant;
    }

    public void setGlutenIntolerant(boolean glutenIntolerant) {
        this.glutenIntolerant = glutenIntolerant;
    }

    public List<String> getAllergies() {
        return allergies;
    }

    public void setAllergies(List<String> allergies) {
        this.allergies = allergies;
    }

    // 添加单个过敏原
    public void addAllergy(String allergy) {
        if (!this.allergies.contains(allergy)) {
            this.allergies.add(allergy);
        }
    }

    // 移除单个过敏原
    public void removeAllergy(String allergy) {
        this.allergies.remove(allergy);
    }

    // 检查是否对某种成分过敏
    public boolean isAllergicTo(String ingredient) {
        return this.allergies.contains(ingredient);
    }

    @Override
    public String toString() {
        return "UserHealthProfile{" +
                "proteinGoal=" + proteinGoal +
                ", fatGoal=" + fatGoal +
                ", carbGoal=" + carbGoal +
                ", dailyCalorieLimit=" + dailyCalorieLimit +
                ", lactoseIntolerant=" + lactoseIntolerant +
                ", glutenIntolerant=" + glutenIntolerant +
                ", allergies=" + allergies +
                '}';
    }
}
