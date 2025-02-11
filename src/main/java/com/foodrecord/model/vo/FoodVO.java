package com.foodrecord.model.vo;

import com.foodrecord.model.entity.BaseEntity;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;

public class FoodVO extends BaseEntity {

    private String id;

    private String code;

    private String name;

    private Integer healthLight;

    private String healthLabel;

    private String suggest;

    private String thumbImageUrl;

    private String largeImageUrl;

    private Boolean isDynamicDish;

    private String contrastPhotoUrl;

    private Boolean isLiquid;

    private Integer isAvailable;

    private String[] prompt;

    public String[] getPrompt() {
        return prompt;
    }
    public void setPrompt(String[] prompt) {
        this.prompt = prompt;
    }


    public String getId() {
        return id;
    }

    public void setId(String id) {
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

    public Integer getAvailable() {
        return isAvailable;
    }

    public void setAvailable(Integer isAvailable) {
        this.isAvailable = isAvailable;
    }
}
