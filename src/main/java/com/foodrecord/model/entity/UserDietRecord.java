package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import java.time.LocalDateTime;

@TableName("user_diet_records")
public class UserDietRecord extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("user_id")
    private Long userId;
    
    @TableField("food_id")
    private Long foodId;
    
    @TableField("portion_size")
    private Float portionSize;
    
    @TableField("meal_time")
    private LocalDateTime mealTime;
    
    @TableField("meal_type")
    private String mealType;
    
    @TableField("notes")
    private String notes;
    
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