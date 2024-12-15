package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;

@TableName("scenes")
public class Scene extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("food_id")
    private Long foodId;
    
    @TableField("scene")
    private String scene;
    
    @TableField("suitable")
    private Boolean suitable;
    
    @TableField("tags")
    private String[] tags;
    
    @TableField("name")
    private String name;
    
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

    public String getScene() {
        return scene;
    }

    public void setScene(String scene) {
        this.scene = scene;
    }

    public Boolean getSuitable() {
        return suitable;
    }

    public void setSuitable(Boolean suitable) {
        this.suitable = suitable;
    }

    public String[] getTags() {
        return tags;
    }

    public void setTags(String[] tags) {
        this.tags = tags;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Food getFood() {
        return food;
    }

    public void setFood(Food food) {
        this.food = food;
    }
}