package com.foodrecord.model.entity.plan;

import com.foodrecord.model.entity.User;
import com.foodrecord.model.entity.UserDietaryGoals;
import com.foodrecord.model.entity.UserHealthData;
import io.swagger.annotations.ApiModelProperty;

public class UserPlanInput {
    @ApiModelProperty(value = "用户名", example = "john_doe")
    private String name;

    @ApiModelProperty(value = "年龄", example = "30")
    private Integer age;

    @ApiModelProperty(value = "性别", example = "1")
    private Integer gender;

    @ApiModelProperty(value = "身高（cm）", example = "175.5")
    private Float height;

    @ApiModelProperty(value = "体重（kg）", example = "70.2")
    private Float weight;

    @ApiModelProperty(value = "BMI 指数", example = "22.5")
    private Float bmi;

    @ApiModelProperty(value = "活动水平", example = "2")
    private Integer activityLevel;

    @ApiModelProperty(value = "健康目标", example = "减重")
    private String healthGoal;

    @ApiModelProperty(value = "每日目标卡路里摄入量", example = "2000")
    private Integer calorieTarget;

    public UserPlanInput(User user, UserHealthData healthData, UserDietaryGoals dietaryGoals) {
        this.name = user.getUsername();
        this.age = healthData.getAge();
        this.gender = healthData.getGender();
        this.height = healthData.getHeight();
        this.weight = healthData.getWeight();
        this.bmi = healthData.getBmi();
        this.activityLevel = healthData.getActivityLevel();
        this.healthGoal = dietaryGoals.getGoalCategory();
        this.calorieTarget = dietaryGoals.getTargetWeight() != null
                ? dietaryGoals.getTargetWeight().intValue()
                : healthData.getDailyCalorieTarget();
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Integer getAge() {
        return age;
    }

    public void setAge(Integer age) {
        this.age = age;
    }

    public Integer getGender() {
        return gender;
    }

    public void setGender(Integer gender) {
        this.gender = gender;
    }

    public Float getHeight() {
        return height;
    }

    public void setHeight(Float height) {
        this.height = height;
    }

    public Float getWeight() {
        return weight;
    }

    public void setWeight(Float weight) {
        this.weight = weight;
    }

    public Float getBmi() {
        return bmi;
    }

    public void setBmi(Float bmi) {
        this.bmi = bmi;
    }

    public Integer getActivityLevel() {
        return activityLevel;
    }

    public void setActivityLevel(Integer activityLevel) {
        this.activityLevel = activityLevel;
    }

    public String getHealthGoal() {
        return healthGoal;
    }

    public void setHealthGoal(String healthGoal) {
        this.healthGoal = healthGoal;
    }

    public Integer getCalorieTarget() {
        return calorieTarget;
    }

    public void setCalorieTarget(Integer calorieTarget) {
        this.calorieTarget = calorieTarget;
    }
}
