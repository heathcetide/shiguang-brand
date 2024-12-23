package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;

@TableName("food_basic")
public class Food extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField(value = "code")
    private String code;
    
    @TableField(value = "name")
    private String name;
    
    @TableField(value = "health_light")
    private Integer healthLight;
    
    @TableField(value = "health_label")
    private String healthLabel;
    
    @TableField(value = "suggest")
    private String suggest;
    
    @TableField(value = "thumb_image_url")
    private String thumbImageUrl;
    
    @TableField(value = "large_image_url")
    private String largeImageUrl;
    
    @TableField(value = "is_dynamic_dish")
    private Boolean isDynamicDish;
    
    @TableField(value = "contrast_photo_url")
    private String contrastPhotoUrl;
    
    @TableField(value = "is_liquid")
    private Boolean isLiquid;

    @TableField(value = "is_available")
    private Integer isAvailable;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Integer getHealthLight() {
        return healthLight;
    }

    public void setHealthLight(Integer healthLight) {
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

    public Boolean getIsDynamicDish() {
        return isDynamicDish;
    }

    public void setIsDynamicDish(Boolean dynamicDish) {
        isDynamicDish = dynamicDish;
    }

    public String getContrastPhotoUrl() {
        return contrastPhotoUrl;
    }

    public void setContrastPhotoUrl(String contrastPhotoUrl) {
        this.contrastPhotoUrl = contrastPhotoUrl;
    }

    public Boolean getIsLiquid() {
        return isLiquid;
    }

    public void setIsLiquid(Boolean liquid) {
        isLiquid = liquid;
    }

    public Integer getIsAvailable() {
        return isAvailable;
    }

    public void setIsAvailable(Integer available) {
        isAvailable = available;
    }

    @Override
    public String toString() {
        return "Food{" +
                "id=" + id +
                ", code='" + code + '\'' +
                ", name='" + name + '\'' +
                ", healthLight=" + healthLight +
                ", healthLabel='" + healthLabel + '\'' +
                ", suggest='" + suggest + '\'' +
                ", thumbImageUrl='" + thumbImageUrl + '\'' +
                ", largeImageUrl='" + largeImageUrl + '\'' +
                ", isDynamicDish=" + isDynamicDish +
                ", contrastPhotoUrl='" + contrastPhotoUrl + '\'' +
                ", isLiquid=" + isLiquid +
                ", isAvailable=" + isAvailable +
                '}';
    }
}