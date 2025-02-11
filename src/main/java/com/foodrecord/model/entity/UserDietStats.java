package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import java.time.LocalDate;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "用户每日饮食统计实体")
@TableName("user_diet_stats")
public class UserDietStats extends BaseEntity {

    @ApiModelProperty(value = "记录ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "统计日期", example = "2024-12-01")
    @TableField("stats_date")
    private LocalDate statsDate;

    @ApiModelProperty(value = "总卡路里摄入", example = "2000.5")
    @TableField("total_calory")
    private Float totalCalory;

    @ApiModelProperty(value = "总蛋白质摄入", example = "80.5")
    @TableField("total_protein")
    private Float totalProtein;

    @ApiModelProperty(value = "总脂肪摄入", example = "50.2")
    @TableField("total_fat")
    private Float totalFat;

    @ApiModelProperty(value = "总碳水化合物摄入", example = "250.0")
    @TableField("total_carbohydrate")
    private Float totalCarbohydrate;

    @ApiModelProperty(value = "总纤维摄入", example = "30.5")
    @TableField("total_fiber")
    private Float totalFiber;

    @ApiModelProperty(value = "早餐卡路里摄入", example = "500.0")
    @TableField("breakfast_calory")
    private Float breakfastCalory;

    @ApiModelProperty(value = "午餐卡路里摄入", example = "800.0")
    @TableField("lunch_calory")
    private Float lunchCalory;

    @ApiModelProperty(value = "晚餐卡路里摄入", example = "700.0")
    @TableField("dinner_calory")
    private Float dinnerCalory;

    @ApiModelProperty(value = "加餐卡路里摄入", example = "100.0")
    @TableField("snack_calory")
    private Float snackCalory;

    @ApiModelProperty(value = "目标达成率（百分比）", example = "95.5")
    @TableField("goal_achievement_rate")
    private Float goalAchievementRate;

    @ApiModelProperty(value = "关联的用户实体")
    @TableField(exist = false)
    private User user;


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

    public LocalDate getStatsDate() {
        return statsDate;
    }

    public void setStatsDate(LocalDate statsDate) {
        this.statsDate = statsDate;
    }

    public Float getTotalCalory() {
        return totalCalory;
    }

    public void setTotalCalory(Float totalCalory) {
        this.totalCalory = totalCalory;
    }

    public Float getTotalProtein() {
        return totalProtein;
    }

    public void setTotalProtein(Float totalProtein) {
        this.totalProtein = totalProtein;
    }

    public Float getTotalFat() {
        return totalFat;
    }

    public void setTotalFat(Float totalFat) {
        this.totalFat = totalFat;
    }

    public Float getTotalCarbohydrate() {
        return totalCarbohydrate;
    }

    public void setTotalCarbohydrate(Float totalCarbohydrate) {
        this.totalCarbohydrate = totalCarbohydrate;
    }

    public Float getTotalFiber() {
        return totalFiber;
    }

    public void setTotalFiber(Float totalFiber) {
        this.totalFiber = totalFiber;
    }

    public Float getBreakfastCalory() {
        return breakfastCalory;
    }

    public void setBreakfastCalory(Float breakfastCalory) {
        this.breakfastCalory = breakfastCalory;
    }

    public Float getLunchCalory() {
        return lunchCalory;
    }

    public void setLunchCalory(Float lunchCalory) {
        this.lunchCalory = lunchCalory;
    }

    public Float getDinnerCalory() {
        return dinnerCalory;
    }

    public void setDinnerCalory(Float dinnerCalory) {
        this.dinnerCalory = dinnerCalory;
    }

    public Float getSnackCalory() {
        return snackCalory;
    }

    public void setSnackCalory(Float snackCalory) {
        this.snackCalory = snackCalory;
    }

    public Float getGoalAchievementRate() {
        return goalAchievementRate;
    }

    public void setGoalAchievementRate(Float goalAchievementRate) {
        this.goalAchievementRate = goalAchievementRate;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }
}