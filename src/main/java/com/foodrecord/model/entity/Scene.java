package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "食物场景实体")
@TableName("scenes")
public class Scene extends BaseEntity {

    @ApiModelProperty(value = "场景ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "食物ID", example = "20002")
    @TableField("food_id")
    private Long foodId;

    @ApiModelProperty(value = "场景描述", example = "户外野餐")
    @TableField("scene")
    private String scene;

    @ApiModelProperty(value = "是否适用", example = "true")
    @TableField("suitable")
    private Boolean suitable;

    @ApiModelProperty(value = "标签集合", example = "[\"健康\",\"清淡\"]")
    @TableField("tags")
    private String[] tags;

    @ApiModelProperty(value = "场景名称", example = "户外场景")
    @TableField("name")
    private String name;

    @ApiModelProperty(value = "关联的食物实体")
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