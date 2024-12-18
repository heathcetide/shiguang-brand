package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "用户健康数据实体")
@TableName("user_health_data")
public class UserHealthData extends BaseEntity {

    @ApiModelProperty(value = "健康数据记录ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "身高（单位：厘米）", example = "170.5")
    @TableField("height")
    private Float height;

    @ApiModelProperty(value = "体重（单位：千克）", example = "65.3")
    @TableField("weight")
    private Float weight;

    @ApiModelProperty(value = "年龄", example = "28")
    @TableField("age")
    private Integer age;

    @ApiModelProperty(value = "性别", example = "male")
    @TableField("gender")
    private String gender;

    @ApiModelProperty(value = "活动水平 (1: 久坐, 2: 轻度活动, 3: 中度活动, 4: 重度活动)", example = "2")
    @TableField("activity_level")
    private Integer activityLevel;

    @ApiModelProperty(value = "健康目标 (减重/增重/维持/营养均衡)", example = "减重")
    @TableField("health_goal")
    private String healthGoal;

    @ApiModelProperty(value = "每日卡路里目标", example = "2000")
    @TableField("daily_calorie_target")
    private Integer dailyCalorieTarget;

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

    public Float getHeight() {
        return height;
    }

    public void setHeight(Float height) {
        this.height = height;
    }

    public Float getWeight() {
        return weight;
    }

    public void setWeight(Float weight) {
        this.weight = weight;
    }

    public Integer getAge() {
        return age;
    }

    public void setAge(Integer age) {
        this.age = age;
    }

    public String getGender() {
        return gender;
    }

    public void setGender(String gender) {
        this.gender = gender;
    }

    public Integer getActivityLevel() {
        return activityLevel;
    }

    public void setActivityLevel(Integer activityLevel) {
        this.activityLevel = activityLevel;
    }

    public String getHealthGoal() {
        return healthGoal;
    }

    public void setHealthGoal(String healthGoal) {
        this.healthGoal = healthGoal;
    }

    public Integer getDailyCalorieTarget() {
        return dailyCalorieTarget;
    }

    public void setDailyCalorieTarget(Integer dailyCalorieTarget) {
        this.dailyCalorieTarget = dailyCalorieTarget;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }
}