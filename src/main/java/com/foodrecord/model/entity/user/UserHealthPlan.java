package com.foodrecord.model.entity.user;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.Date;

@ApiModel(description = "用户每日健康计划实体类")
@TableName("user_health_plan")
public class UserHealthPlan implements Serializable {

    private static final long serialVersionUID = 1L;

    @ApiModelProperty(value = "计划记录ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "饮食目标ID", example = "1001")
    @TableField("goal_id")
    private Long goalId;

    @ApiModelProperty(value = "计划日期", example = "2024-01-01")
    @TableField("plan_date")
    private Date planDate;

    @ApiModelProperty(value = "计划类型（饮食、运动、其他）", example = "饮食")
    @TableField("plan_category")
    private String planCategory;

    @ApiModelProperty(value = "计划内容（具体计划描述）", example = "早餐吃1000千卡")
    @TableField("plan_content")
    private String planContent;

    @ApiModelProperty(value = "计划状态（未开始, 进行中, 已结束）", example = "未开始")
    @TableField("status")
    private String status;

    @ApiModelProperty(value = "计划完成进度百分比（0-100）", example = "50.0")
    @TableField("progress")
    private Float progress;

    @ApiModelProperty(value = "每日食谱", example = "[\"早餐: 燕麦+牛奶\", \"午餐: 鸡胸肉+蔬菜\", \"晚餐: 牛排+红酒\"]")
    @TableField("meals")
    private String meals; // JSON 格式存储为字符串

    @ApiModelProperty(value = "每日运动计划", example = "[\"跑步30分钟\", \"力量训练20分钟\"]")
    @TableField("exercises")
    private String exercises; // JSON 格式存储为字符串

    @ApiModelProperty(value = "今日运动目标（单位：分钟或其他）", example = "60.0")
    @TableField("today_exercise_target")
    private Float todayExerciseTarget;

    @ApiModelProperty(value = "今日实际完成运动量", example = "30.0")
    @TableField("today_exercise_completed")
    private Float todayExerciseCompleted;

    @ApiModelProperty(value = "今日目标卡路里摄入量", example = "2000.0")
    @TableField("today_calorie_target")
    private Float todayCalorieTarget;

    @ApiModelProperty(value = "今日实际摄入的卡路里", example = "1500.0")
    @TableField("today_calorie_completed")
    private Float todayCalorieCompleted;

    @ApiModelProperty(value = "创建时间", example = "2024-01-01 12:00:00")
    @TableField("created_at")
    private LocalDateTime createdAt;

    @ApiModelProperty(value = "更新时间", example = "2024-01-01 13:00:00")
    @TableField("updated_at")
    private LocalDateTime updatedAt;

    // Getters and Setters
    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getGoalId() {
        return goalId;
    }

    public void setGoalId(Long goalId) {
        this.goalId = goalId;
    }

    public Date getPlanDate() {
        return planDate;
    }

    public void setPlanDate(Date planDate) {
        this.planDate = planDate;
    }

    public String getPlanCategory() {
        return planCategory;
    }

    public void setPlanCategory(String planCategory) {
        this.planCategory = planCategory;
    }

    public String getPlanContent() {
        return planContent;
    }

    public void setPlanContent(String planContent) {
        this.planContent = planContent;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Float getProgress() {
        return progress;
    }

    public void setProgress(Float progress) {
        this.progress = progress;
    }

    public Float getTodayExerciseTarget() {
        return todayExerciseTarget;
    }

    public void setTodayExerciseTarget(Float todayExerciseTarget) {
        this.todayExerciseTarget = todayExerciseTarget;
    }

    public Float getTodayExerciseCompleted() {
        return todayExerciseCompleted;
    }

    public void setTodayExerciseCompleted(Float todayExerciseCompleted) {
        this.todayExerciseCompleted = todayExerciseCompleted;
    }

    public Float getTodayCalorieTarget() {
        return todayCalorieTarget;
    }

    public void setTodayCalorieTarget(Float todayCalorieTarget) {
        this.todayCalorieTarget = todayCalorieTarget;
    }

    public Float getTodayCalorieCompleted() {
        return todayCalorieCompleted;
    }

    public void setTodayCalorieCompleted(Float todayCalorieCompleted) {
        this.todayCalorieCompleted = todayCalorieCompleted;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getMeals() {
        return meals;
    }

    public void setMeals(String meals) {
        this.meals = meals;
    }

    public String getExercises() {
        return exercises;
    }

    public void setExercises(String exercises) {
        this.exercises = exercises;
    }
}
