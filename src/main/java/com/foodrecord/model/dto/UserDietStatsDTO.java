package com.foodrecord.model.dto;

import java.time.LocalDate;

public class UserDietStatsDTO {
    private Long id;
    private Long userId;
    private LocalDate statsDate;
    private Float totalCalory;
    private Float totalProtein;
    private Float totalFat;
    private Float totalCarbohydrate;
    private Float totalFiber;
    private Float breakfastCalory;
    private Float lunchCalory;
    private Float dinnerCalory;
    private Float snackCalory;
    private Float goalAchievementRate;

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
}