package com.foodrecord.ml.model;

public class FoodNutrition {
    private double calories;       // 卡路里
    private double protein;        // 蛋白质 (克)
    private double fat;            // 脂肪 (克)
    private double carbohydrate;   // 碳水化合物 (克)
    private boolean containsLactose; // 是否含乳糖（用于过敏风险评估）
    private boolean containsGluten;  // 是否含麸质（用于过敏风险评估）

    // 构造函数
    public FoodNutrition(double calories, double protein, double fat, double carbohydrate, boolean containsLactose, boolean containsGluten) {
        this.calories = calories;
        this.protein = protein;
        this.fat = fat;
        this.carbohydrate = carbohydrate;
        this.containsLactose = containsLactose;
        this.containsGluten = containsGluten;
    }

    // Getters 和 Setters
    public double getCalories() {
        return calories;
    }

    public void setCalories(double calories) {
        this.calories = calories;
    }

    public double getProtein() {
        return protein;
    }

    public void setProtein(double protein) {
        this.protein = protein;
    }

    public double getFat() {
        return fat;
    }

    public void setFat(double fat) {
        this.fat = fat;
    }

    public double getCarbohydrate() {
        return carbohydrate;
    }

    public void setCarbohydrate(double carbohydrate) {
        this.carbohydrate = carbohydrate;
    }

    public boolean containsLactose() {
        return containsLactose;
    }

    public void setContainsLactose(boolean containsLactose) {
        this.containsLactose = containsLactose;
    }

    public boolean containsGluten() {
        return containsGluten;
    }

    public boolean isContainsLactose() {
        return containsLactose;
    }

    public boolean isContainsGluten() {
        return containsGluten;
    }

    public void setContainsGluten(boolean containsGluten) {
        this.containsGluten = containsGluten;
    }
}