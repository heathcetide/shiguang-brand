package com.foodrecord.model.dto;

import javax.validation.constraints.*;

public class UserFeedbackDTO {
    private Long id;
    
    @NotNull(message = "食物ID不能为空")
    private Long foodId;
    
    @NotNull(message = "评分不能为空")
    @Min(value = 1, message = "评分必须在1-5之间")
    @Max(value = 5, message = "评分必须在1-5之间")
    private Integer rating;
    
    @Size(max = 500, message = "评论不能超过500字")
    private String comment;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public @NotNull(message = "食物ID不能为空") Long getFoodId() {
        return foodId;
    }

    public void setFoodId(@NotNull(message = "食物ID不能为空") Long foodId) {
        this.foodId = foodId;
    }

    public @NotNull(message = "评分不能为空") @Min(value = 1, message = "评分必须在1-5之间") @Max(value = 5, message = "评分必须在1-5之间") Integer getRating() {
        return rating;
    }

    public void setRating(@NotNull(message = "评分不能为空") @Min(value = 1, message = "评分必须在1-5之间") @Max(value = 5, message = "评分必须在1-5之间") Integer rating) {
        this.rating = rating;
    }

    public @Size(max = 500, message = "评论不能超过500字") String getComment() {
        return comment;
    }

    public void setComment(@Size(max = 500, message = "评论不能超过500字") String comment) {
        this.comment = comment;
    }
    public UserFeedbackDTO(){

    }

    public UserFeedbackDTO(Long foodId, Integer rating, String comment) {
        this.foodId = foodId;
        this.rating = rating;
        this.comment = comment;
    }
}