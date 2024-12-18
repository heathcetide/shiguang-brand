package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "用户饮食目标实体")
@TableName("user_dietary_goals")
public class UserDietaryGoals extends BaseEntity {

    @ApiModelProperty(value = "目标记录ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "蛋白质目标（单位：克）", example = "100.0")
    @TableField("protein_target")
    private Float proteinTarget;

    @ApiModelProperty(value = "脂肪目标（单位：克）", example = "50.0")
    @TableField("fat_target")
    private Float fatTarget;

    @ApiModelProperty(value = "碳水目标（单位：克）", example = "250.0")
    @TableField("carb_target")
    private Float carbTarget;

    @ApiModelProperty(value = "纤维目标（单位：克）", example = "30.0")
    @TableField("fiber_target")
    private Float fiberTarget;

    @ApiModelProperty(value = "关联的用户实体")
    @TableField(exist = false)
    private User user;
    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Float getProteinTarget() {
        return proteinTarget;
    }

    public void setProteinTarget(Float proteinTarget) {
        this.proteinTarget = proteinTarget;
    }

    public Float getFatTarget() {
        return fatTarget;
    }

    public void setFatTarget(Float fatTarget) {
        this.fatTarget = fatTarget;
    }

    public Float getCarbTarget() {
        return carbTarget;
    }

    public void setCarbTarget(Float carbTarget) {
        this.carbTarget = carbTarget;
    }

    public Float getFiberTarget() {
        return fiberTarget;
    }

    public void setFiberTarget(Float fiberTarget) {
        this.fiberTarget = fiberTarget;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }
}