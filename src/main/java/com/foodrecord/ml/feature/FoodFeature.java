package com.foodrecord.ml.feature;


public class FoodFeature {
    private Long foodId;
    private Float calory;
    private Float protein;
    private Float fat;
    private Float carbohydrate;
    private Integer healthLight;
    private String healthLabel;
    private Float averageRating;  // 平均评分
    private Float popularityScore; // 流行度评分
    private double[] featureArray = {
            //假设的数据后面要动态修改
            250.0,     // 热量
            12.5,      // 蛋白质含量
            8.0,       // 脂肪含量
            30.0,      // 碳水化合物含量
            2.0,       // 健康灯
            1.0, 0.0,  // 健康标签 One-Hot 编码 (假设有 ["LowSugar", "HighProtein"] 标签)
            4.5,       // 平均评分
            200.0      // 流行度评分
    };
    // 其他食物特征

    public double[] getFeatureArray() {
        return featureArray;
    }

    public void setFeatureArray(double[] featureArray) {
        this.featureArray = featureArray;
    }

    public Long getFoodId() {
        return foodId;
    }

    public void setFoodId(Long foodId) {
        this.foodId = foodId;
    }

    public Float getCalory() {
        return calory;
    }

    public void setCalory(Float calory) {
        this.calory = calory;
    }

    public Float getProtein() {
        return protein;
    }

    public void setProtein(Float protein) {
        this.protein = protein;
    }

    public Float getFat() {
        return fat;
    }

    public void setFat(Float fat) {
        this.fat = fat;
    }

    public Float getCarbohydrate() {
        return carbohydrate;
    }

    public void setCarbohydrate(Float carbohydrate) {
        this.carbohydrate = carbohydrate;
    }

    public Integer getHealthLight() {
        return healthLight;
    }

    public void setHealthLight(Integer healthLight) {
        this.healthLight = healthLight;
    }

    public String getHealthLabel() {
        return healthLabel;
    }

    public void setHealthLabel(String healthLabel) {
        this.healthLabel = healthLabel;
    }

    public Float getAverageRating() {
        return averageRating;
    }

    public void setAverageRating(Float averageRating) {
        this.averageRating = averageRating;
    }

    public Float getPopularityScore() {
        return popularityScore;
    }

    public void setPopularityScore(Float popularityScore) {
        this.popularityScore = popularityScore;
    }
}
