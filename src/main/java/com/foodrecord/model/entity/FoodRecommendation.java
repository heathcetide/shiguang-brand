package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.foodrecord.model.entity.user.User;

@TableName("food_recommendations")
public class FoodRecommendation extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("user_id")
    private Long userId;
    
    @TableField("food_id")
    private Long foodId;
    
    @TableField("recommendation_type")
    private String recommendationType;  // HEALTH_GOAL, NUTRITION_BALANCE, PREFERENCE
    
    @TableField("recommendation_score")
    private Double recommendationScore;
    
    @TableField("reason")
    private String reason;
    
    @TableField(exist = false)
    private User user;
    
    @TableField(exist = false)
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

    public String getRecommendationType() {
        return recommendationType;
    }

    public void setRecommendationType(String recommendationType) {
        this.recommendationType = recommendationType;
    }

    public Double getRecommendationScore() {
        return recommendationScore;
    }

    public void setRecommendationScore(Double recommendationScore) {
        this.recommendationScore = recommendationScore;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
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