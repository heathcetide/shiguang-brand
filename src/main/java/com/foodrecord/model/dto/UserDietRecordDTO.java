package com.foodrecord.model.dto;

import javax.validation.constraints.NotNull;
import javax.validation.constraints.Positive;
import java.time.LocalDateTime;

public class UserDietRecordDTO {
    private Long id;
    
    @NotNull(message = "食物ID不能为空")
    private Long foodId;
    
    @NotNull(message = "份量不能为空")
    @Positive(message = "份量必须大于0")
    private Float portionSize;
    
    @NotNull(message = "用餐时间不能为空")
    private LocalDateTime mealTime;
    
    private String mealType;
    private String notes;

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

    public @NotNull(message = "份量不能为空") @Positive(message = "份量必须大于0") Float getPortionSize() {
        return portionSize;
    }

    public void setPortionSize(@NotNull(message = "份量不能为空") @Positive(message = "份量必须大于0") Float portionSize) {
        this.portionSize = portionSize;
    }

    public @NotNull(message = "用餐时间不能为空") LocalDateTime getMealTime() {
        return mealTime;
    }

    public void setMealTime(@NotNull(message = "用餐时间不能为空") LocalDateTime mealTime) {
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
}