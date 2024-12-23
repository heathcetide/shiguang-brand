package com.foodrecord.model.entity.user;

import com.baomidou.mybatisplus.annotation.*;
import com.foodrecord.model.entity.BaseEntity;
import com.foodrecord.model.entity.Food;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "用户反馈信息实体")
@TableName("user_feedback")
public class UserFeedback extends BaseEntity {

    @ApiModelProperty(value = "反馈记录ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "食物ID", example = "20002")
    @TableField("food_id")
    private Long foodId;

    @ApiModelProperty(value = "评分（1到5）", example = "4")
    @TableField("rating")
    private Integer rating;

    @ApiModelProperty(value = "用户评论", example = "非常好吃！")
    @TableField("comment")
    private String comment;

    @ApiModelProperty(value = "反馈状态", example = "approved")
    @TableField("status")
    private String status;

    @ApiModelProperty(value = "关联的用户实体")
    @TableField(exist = false)
    private User user;

    @ApiModelProperty(value = "关联的食物实体")
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

    public UserFeedback(Long id, Long userId, Long foodId, Integer rating, String comment, String status,User user) {
        this.id = id;
        this.userId = userId;
        this.foodId = foodId;
        this.rating = rating;
        this.comment = comment;
        this.status = status;
        this.user = user;
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