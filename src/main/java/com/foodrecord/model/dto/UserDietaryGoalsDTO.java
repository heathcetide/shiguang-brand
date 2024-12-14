package com.foodrecord.model.dto;

import javax.validation.constraints.*;

public class UserDietaryGoalsDTO {
    private Long id;
    
    @NotNull(message = "蛋白质目标不能为空")
    @PositiveOrZero(message = "蛋白质目标必须大于等于0")
    private Float proteinTarget;
    
    @NotNull(message = "脂肪目标不能为空")
    @PositiveOrZero(message = "脂肪目标必须大于等于0")
    private Float fatTarget;
    
    @NotNull(message = "碳水化合物目标不能为空")
    @PositiveOrZero(message = "碳水化合物目标必须大于等于0")
    private Float carbTarget;
    
    @NotNull(message = "膳食纤维目标不能为空")
    @PositiveOrZero(message = "膳食纤维目标必须大于等于0")
    private Float fiberTarget;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public @NotNull(message = "蛋白质目标不能为空") @PositiveOrZero(message = "蛋白质目标必须大于等于0") Float getProteinTarget() {
        return proteinTarget;
    }

    public void setProteinTarget(@NotNull(message = "蛋白质目标不能为空") @PositiveOrZero(message = "蛋白质目标必须大于等于0") Float proteinTarget) {
        this.proteinTarget = proteinTarget;
    }

    public @NotNull(message = "脂肪目标不能为空") @PositiveOrZero(message = "脂肪目标必须大于等于0") Float getFatTarget() {
        return fatTarget;
    }

    public void setFatTarget(@NotNull(message = "脂肪目标不能为空") @PositiveOrZero(message = "脂肪目标必须大于等于0") Float fatTarget) {
        this.fatTarget = fatTarget;
    }

    public @NotNull(message = "碳水化合物目标不能为空") @PositiveOrZero(message = "碳水化合物目标必须大于等于0") Float getCarbTarget() {
        return carbTarget;
    }

    public void setCarbTarget(@NotNull(message = "碳水化合物目标不能为空") @PositiveOrZero(message = "碳水化合物目标必须大于等于0") Float carbTarget) {
        this.carbTarget = carbTarget;
    }

    public @NotNull(message = "膳食纤维目标不能为空") @PositiveOrZero(message = "膳食纤维目标必须大于等于0") Float getFiberTarget() {
        return fiberTarget;
    }

    public void setFiberTarget(@NotNull(message = "膳食纤维目标不能为空") @PositiveOrZero(message = "膳食纤维目标必须大于等于0") Float fiberTarget) {
        this.fiberTarget = fiberTarget;
    }
}