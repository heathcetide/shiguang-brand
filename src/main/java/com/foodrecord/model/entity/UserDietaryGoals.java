package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;


@TableName("user_dietary_goals")
public class UserDietaryGoals extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("user_id")
    private Long userId;
    
    @TableField("protein_target")
    private Float proteinTarget;
    
    @TableField("fat_target")
    private Float fatTarget;
    
    @TableField("carb_target")
    private Float carbTarget;
    
    @TableField("fiber_target")
    private Float fiberTarget;
    
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