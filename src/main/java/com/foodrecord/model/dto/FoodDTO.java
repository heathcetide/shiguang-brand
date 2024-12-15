package com.foodrecord.model.dto;


import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

public class FoodDTO {
    private Long id;
    
    @NotBlank(message = "食物编码不能为空")
    private String code;
    
    @NotBlank(message = "食物名称不能为空")
    private String name;
    
    @NotNull(message = "健康指示灯不能为空")
    private Integer healthLight;
    
    private String healthLabel;
    private String suggest;
    private String thumbImageUrl;
    private String largeImageUrl;
    private Boolean isDynamicDish;
    private String contrastPhotoUrl;
    private Boolean isLiquid;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public @NotBlank(message = "食物编码不能为空") String getCode() {
        return code;
    }

    public void setCode(@NotBlank(message = "食物编码不能为空") String code) {
        this.code = code;
    }

    public @NotBlank(message = "食物名称不能为空") String getName() {
        return name;
    }

    public void setName(@NotBlank(message = "食物名称不能为空") String name) {
        this.name = name;
    }

    public @NotNull(message = "健康指示灯不能为空") Integer getHealthLight() {
        return healthLight;
    }

    public void setHealthLight(@NotNull(message = "健康指示灯不能为空") Integer healthLight) {
        this.healthLight = healthLight;
    }

    public String getHealthLabel() {
        return healthLabel;
    }

    public void setHealthLabel(String healthLabel) {
        this.healthLabel = healthLabel;
    }

    public String getSuggest() {
        return suggest;
    }

    public void setSuggest(String suggest) {
        this.suggest = suggest;
    }

    public String getThumbImageUrl() {
        return thumbImageUrl;
    }

    public void setThumbImageUrl(String thumbImageUrl) {
        this.thumbImageUrl = thumbImageUrl;
    }

    public String getLargeImageUrl() {
        return largeImageUrl;
    }

    public void setLargeImageUrl(String largeImageUrl) {
        this.largeImageUrl = largeImageUrl;
    }

    public Boolean getDynamicDish() {
        return isDynamicDish;
    }

    public void setDynamicDish(Boolean dynamicDish) {
        isDynamicDish = dynamicDish;
    }

    public String getContrastPhotoUrl() {
        return contrastPhotoUrl;
    }

    public void setContrastPhotoUrl(String contrastPhotoUrl) {
        this.contrastPhotoUrl = contrastPhotoUrl;
    }

    public Boolean getLiquid() {
        return isLiquid;
    }

    public void setLiquid(Boolean liquid) {
        isLiquid = liquid;
    }
}