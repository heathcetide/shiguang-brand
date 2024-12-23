package com.foodrecord.model.entity.plan;

import io.swagger.annotations.ApiModelProperty;

import java.util.Date;
import java.util.List;

public class DailyPlan {
    @ApiModelProperty(value = "计划日期", example = "2024-12-25")
    private Date date;

    @ApiModelProperty(value = "每日食谱", example = "[\"早餐: 燕麦+牛奶\", \"午餐: 鸡胸肉+蔬菜\", \"晚餐: 牛排+红酒\"]")
    private List<String> meals;

    @ApiModelProperty(value = "每日运动计划", example = "[\"跑步30分钟\", \"力量训练20分钟\"]")
    private List<String> exercises;

    @ApiModelProperty(value = "每日目标卡路里摄入", example = "2000")
    private Float calories;

    @ApiModelProperty(value = "每日目标运动时间", example = "50")
    private Float exerciseMinutes;

    public Date getDate() {
        return date;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public List<String> getMeals() {
        return meals;
    }

    public void setMeals(List<String> meals) {
        this.meals = meals;
    }

    public List<String> getExercises() {
        return exercises;
    }

    public void setExercises(List<String> exercises) {
        this.exercises = exercises;
    }

    public Float getCalories() {
        return calories;
    }

    public void setCalories(Float calories) {
        this.calories = calories;
    }

    public Float getExerciseMinutes() {
        return exerciseMinutes;
    }

    public void setExerciseMinutes(Float exerciseMinutes) {
        this.exerciseMinutes = exerciseMinutes;
    }
}
