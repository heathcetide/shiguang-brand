package com.foodrecord.ml.entity;

import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.user.User;

import java.util.Date;

public class UserFoodInteraction {
    private Long id;
    private Long userId;
    private Long foodId;
    private Double rating;
    private Date interactionTime;
    private String interactionType; // VIEW, LIKE, RATE, CONSUME

    private User user;

    private Food food;

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

    public Long getFoodId() {
        return foodId;
    }

    public void setFoodId(Long foodId) {
        this.foodId = foodId;
    }

    public Double getRating() {
        return rating;
    }

    public void setRating(Double rating) {
        this.rating = rating;
    }

    public Date getInteractionTime() {
        return interactionTime;
    }

    public void setInteractionTime(Date interactionTime) {
        this.interactionTime = interactionTime;
    }

    public String getInteractionType() {
        return interactionType;
    }

    public void setInteractionType(String interactionType) {
        this.interactionType = interactionType;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }

    public Food getFood() {
        return food;
    }

    public void setFood(Food food) {
        this.food = food;
    }
}