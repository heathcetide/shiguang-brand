package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import java.time.LocalDate;

@TableName("user_diet_stats")
public class UserDietStats extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("user_id")
    private Long userId;
    
    @TableField("stats_date")
    private LocalDate statsDate;
    
    @TableField("total_calory")
    private Float totalCalory;
    
    @TableField("total_protein")
    private Float totalProtein;
    
    @TableField("total_fat")
    private Float totalFat;
    
    @TableField("total_carbohydrate")
    private Float totalCarbohydrate;
    
    @TableField("total_fiber")
    private Float totalFiber;
    
    @TableField("breakfast_calory")
    private Float breakfastCalory;
    
    @TableField("lunch_calory")
    private Float lunchCalory;
    
    @TableField("dinner_calory")
    private Float dinnerCalory;
    
    @TableField("snack_calory")
    private Float snackCalory;
    
    @TableField("goal_achievement_rate")
    private Float goalAchievementRate;
    
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