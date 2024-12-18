package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.time.LocalDateTime;
@ApiModel(description = "用户饮食记录实体")
@TableName("user_diet_records")
public class UserDietRecord extends BaseEntity {

    @ApiModelProperty(value = "饮食记录ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "食物ID", example = "20002")
    @TableField("food_id")
    private Long foodId;

    @ApiModelProperty(value = "份量大小", example = "150.0")
    @TableField("portion_size")
    private Float portionSize;

    @ApiModelProperty(value = "用餐时间", example = "2024-12-16T12:30:00")
    @TableField("meal_time")
    private LocalDateTime mealTime;

    @ApiModelProperty(value = "用餐类型（早餐/午餐/晚餐/加餐）", example = "午餐")
    @TableField("meal_type")
    private String mealType;

    @ApiModelProperty(value = "备注信息", example = "低脂餐")
    @TableField("notes")
    private String notes;

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

    public Float getPortionSize() {
        return portionSize;
    }

    public void setPortionSize(Float portionSize) {
        this.portionSize = portionSize;
    }

    public LocalDateTime getMealTime() {
        return mealTime;
    }

    public void setMealTime(LocalDateTime mealTime) {
        this.mealTime = mealTime;
    }

    public String getMealType() {
        return mealType;
    }

    public void setMealType(String mealType) {
        this.mealType = mealType;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
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