package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import com.foodrecord.model.vo.FoodVO;
import org.jetbrains.annotations.NotNull;
import org.springframework.data.annotation.Id;
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.elasticsearch.annotations.Field;
import org.springframework.data.elasticsearch.annotations.FieldType;

@TableName("food_basic")
@Document(indexName = "food")
public class Food extends BaseEntity {
    @TableId(type = IdType.AUTO)
    @Id
    private Long id;

    @Field(type = FieldType.Keyword) // 精确匹配字段
    @TableField(value = "code")
    private String code;

    @Field(type = FieldType.Text, analyzer = "ik_max_word", searchAnalyzer = "ik_max_word") // 中文分词
    @TableField(value = "name")
    private String name;

    @Field(type = FieldType.Integer) // 健康灯字段
    @TableField(value = "health_light")
    private Integer healthLight;

    @Field(type = FieldType.Text, analyzer = "ik_max_word", searchAnalyzer = "ik_max_word")
    @TableField(value = "health_label")
    private String healthLabel;

    @Field(type = FieldType.Text, analyzer = "ik_max_word", searchAnalyzer = "ik_max_word")
    @TableField(value = "suggest")
    private String suggest;

    @Field(type = FieldType.Keyword)
    @TableField(value = "thumb_image_url")
    private String thumbImageUrl;

    @Field(type = FieldType.Keyword)
    @TableField(value = "large_image_url")
    private String largeImageUrl;

    @Field(type = FieldType.Boolean)
    @TableField(value = "is_dynamic_dish")
    private Boolean isDynamicDish;

    @Field(type = FieldType.Keyword)
    @TableField(value = "contrast_photo_url")
    private String contrastPhotoUrl;

    @Field(type = FieldType.Boolean)
    @TableField(value = "is_liquid")
    private Boolean isLiquid;

    @Field(type = FieldType.Integer)
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

    @Field(type = FieldType.Text, analyzer = "standard")
    private String[] prompt;
    public String[] getPrompt() {
        return prompt;
    }
    public void setPrompt(String[] prompt) {
        this.prompt = prompt;
    }

    public static @NotNull FoodVO getFoodVO(Food food) {
        FoodVO foodVO = new FoodVO();
        foodVO.setId(food.getId().toString());
        foodVO.setCode(food.getCode());
        foodVO.setName(food.getName());
        foodVO.setHealthLight(food.getHealthLight());
        foodVO.setHealthLabel(food.getHealthLabel());
        foodVO.setSuggest(food.getSuggest());
        foodVO.setThumbImageUrl(food.getThumbImageUrl());
        foodVO.setLargeImageUrl(food.getLargeImageUrl());
        foodVO.setDynamicDish(food.getIsDynamicDish());
        foodVO.setContrastPhotoUrl(food.getContrastPhotoUrl());
        foodVO.setLiquid(food.getIsLiquid());
        foodVO.setAvailable(food.getIsAvailable());
        foodVO.setPrompt(food.getPrompt());
        foodVO.setCreatedAt(food.getCreatedAt());
        foodVO.setUpdatedAt(food.getUpdatedAt());
        return foodVO;
    }

}