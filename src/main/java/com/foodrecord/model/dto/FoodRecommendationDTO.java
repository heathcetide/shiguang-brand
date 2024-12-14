package com.foodrecord.model.dto;

import javax.validation.constraints.*;

public class FoodRecommendationDTO {
    private Long id;
    
    @NotNull(message = "用户ID不能为空")
    private Long userId;
    
    @NotNull(message = "食物ID不能为空")
    private Long foodId;
    
    @NotBlank(message = "推荐类型不能为空")
    private String recommendationType;
    
    @NotNull(message = "推荐分数不能为空")
    @PositiveOrZero(message = "推荐分数必须大于等于0")
    private Double recommendationScore;
    
    private String reason;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public @NotNull(message = "用户ID不能为空") Long getUserId() {
        return userId;
    }

    public void setUserId(@NotNull(message = "用户ID不能为空") Long userId) {
        this.userId = userId;
    }

    public @NotNull(message = "食物ID不能为空") Long getFoodId() {
        return foodId;
    }

    public void setFoodId(@NotNull(message = "食物ID不能为空") Long foodId) {
        this.foodId = foodId;
    }

    public @NotBlank(message = "推荐类型不能为空") String getRecommendationType() {
        return recommendationType;
    }

    public void setRecommendationType(@NotBlank(message = "推荐类型不能为空") String recommendationType) {
        this.recommendationType = recommendationType;
    }

    public @NotNull(message = "推荐分数不能为空") @PositiveOrZero(message = "推荐分数必须大于等于0") Double getRecommendationScore() {
        return recommendationScore;
    }

    public void setRecommendationScore(@NotNull(message = "推荐分数不能为空") @PositiveOrZero(message = "推荐分数必须大于等于0") Double recommendationScore) {
        this.recommendationScore = recommendationScore;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }
}