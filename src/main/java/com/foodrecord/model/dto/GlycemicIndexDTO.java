package com.foodrecord.model.dto;

import javax.validation.constraints.NotNull;

public class GlycemicIndexDTO {
    private Long id;
    
    @NotNull(message = "食物ID不能为空")
    private Long foodId;
    
    private Float giValue;
    private String giLabel;
    private Float glValue;
    private String glLabel;

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

    public Float getGiValue() {
        return giValue;
    }

    public void setGiValue(Float giValue) {
        this.giValue = giValue;
    }

    public String getGiLabel() {
        return giLabel;
    }

    public void setGiLabel(String giLabel) {
        this.giLabel = giLabel;
    }

    public Float getGlValue() {
        return glValue;
    }

    public void setGlValue(Float glValue) {
        this.glValue = glValue;
    }

    public String getGlLabel() {
        return glLabel;
    }

    public void setGlLabel(String glLabel) {
        this.glLabel = glLabel;
    }
}