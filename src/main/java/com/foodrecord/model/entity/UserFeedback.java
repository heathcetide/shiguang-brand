package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;

@TableName("user_feedback")
public class UserFeedback extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("user_id")
    private Long userId;
    
    @TableField("food_id")
    private Long foodId;
    
    @TableField("rating")
    private Integer rating;
    
    @TableField("comment")
    private String comment;

    @TableField("status")
    private String status;
    
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

    public Integer getRating() {
        return rating;
    }

    public void setRating(Integer rating) {
        this.rating = rating;
    }

    public String getComment() {
        return comment;
    }

    public void setComment(String comment) {
        this.comment = comment;
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

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public UserFeedback(){

    }

    public UserFeedback(Long id, Long userId, Long foodId, Integer rating, String comment, String status, User user, Food food) {
        this.id = id;
        this.userId = userId;
        this.foodId = foodId;
        this.rating = rating;
        this.comment = comment;
        this.status = status;
        this.user = user;
        this.food = food;
    }

    @Override
    public String toString() {
        return "UserFeedback{" +
                "id=" + id +
                ", userId=" + userId +
                ", foodId=" + foodId +
                ", rating=" + rating +
                ", comment='" + comment + '\'' +
                ", status='" + status + '\'' +
                ", user=" + user +
                ", food=" + food +
                '}';
    }
}