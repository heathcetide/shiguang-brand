package com.foodrecord.model.dto;

import javax.validation.constraints.*;

public class UserHealthDataDTO {
    private Long id;
    
    @NotNull(message = "身高不能为空")
    @Positive(message = "身高必须大于0")
    private Float height;
    
    @NotNull(message = "体重不能为空")
    @Positive(message = "体重必须大于0")
    private Float weight;
    
    @NotNull(message = "年龄不能为空")
    @Min(value = 1, message = "年龄必须大于0")
    @Max(value = 150, message = "年龄不能超过150")
    private Integer age;
    
    @NotBlank(message = "性别不能为空")
    private String gender;
    
    @NotNull(message = "活动水平不能为空")
    @Min(value = 1, message = "活动水平必须在1-4之间")
    @Max(value = 4, message = "活动水平必须在1-4之间")
    private Integer activityLevel;
    
    @NotBlank(message = "健康目标不能为空")
    private String healthGoal;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public @NotNull(message = "身高不能为空") @Positive(message = "身高必须大于0") Float getHeight() {
        return height;
    }

    public void setHeight(@NotNull(message = "身高不能为空") @Positive(message = "身高必须大于0") Float height) {
        this.height = height;
    }

    public @NotNull(message = "体重不能为空") @Positive(message = "体重必须大于0") Float getWeight() {
        return weight;
    }

    public void setWeight(@NotNull(message = "体重不能为空") @Positive(message = "体重必须大于0") Float weight) {
        this.weight = weight;
    }

    public @NotNull(message = "年龄不能为空") @Min(value = 1, message = "年龄必须大于0") @Max(value = 150, message = "年龄不能超过150") Integer getAge() {
        return age;
    }

    public void setAge(@NotNull(message = "年龄不能为空") @Min(value = 1, message = "年龄必须大于0") @Max(value = 150, message = "年龄不能超过150") Integer age) {
        this.age = age;
    }

    public @NotBlank(message = "性别不能为空") String getGender() {
        return gender;
    }

    public void setGender(@NotBlank(message = "性别不能为空") String gender) {
        this.gender = gender;
    }

    public @NotNull(message = "活动水平不能为空") @Min(value = 1, message = "活动水平必须在1-4之间") @Max(value = 4, message = "活动水平必须在1-4之间") Integer getActivityLevel() {
        return activityLevel;
    }

    public void setActivityLevel(@NotNull(message = "活动水平不能为空") @Min(value = 1, message = "活动水平必须在1-4之间") @Max(value = 4, message = "活动水平必须在1-4之间") Integer activityLevel) {
        this.activityLevel = activityLevel;
    }

    public @NotBlank(message = "健康目标不能为空") String getHealthGoal() {
        return healthGoal;
    }

    public void setHealthGoal(@NotBlank(message = "健康目标不能为空") String healthGoal) {
        this.healthGoal = healthGoal;
    }
}