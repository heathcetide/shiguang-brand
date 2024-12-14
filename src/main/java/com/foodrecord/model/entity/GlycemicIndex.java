package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;


@TableName("glycemic_index")
public class GlycemicIndex extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("food_id")
    private Long foodId;
    
    @TableField("gi_value")
    private Float giValue;
    
    @TableField("gi_label")
    private String giLabel;
    
    @TableField("gl_value")
    private Float glValue;
    
    @TableField("gl_label")
    private String glLabel;
    
    @TableField(exist = false)
    private Food food;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getFoodId() {
        return foodId;
    }

    public void setFoodId(Long foodId) {
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

    public Food getFood() {
        return food;
    }

    public void setFood(Food food) {
        this.food = food;
    }
}