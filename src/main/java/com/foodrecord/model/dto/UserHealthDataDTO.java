package com.foodrecord.model.dto;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import javax.validation.constraints.*;
import java.io.Serializable;
@ApiModel(value = "UserHealthDataDTO", description = "用户健康数据传输对象")
public class UserHealthDataDTO implements Serializable {

    @ApiModelProperty(value = "主键ID", example = "1")
    private Long id;

    @ApiModelProperty(value = "用户ID（唯一标识）", example = "1001", required = true)
    private Long userId;

    @ApiModelProperty(value = "用户姓名", example = "张三", required = true)
    private String name;

    @ApiModelProperty(value = "性别（0 = 女，1 = 男）", example = "1", required = true)
    private Integer gender;

    @ApiModelProperty(value = "年龄", example = "30", required = true)
//    @Min(value = 1, message = "年龄必须大于0")
//    @Max(value = 150, message = "年龄不能超过150")
    private Integer age;

    @ApiModelProperty(value = "身高（cm）", example = "175.5", required = true)
//    @NotNull(message = "身高不能为空")
//    @Positive(message = "身高必须大于0")
    private Float height;

    @ApiModelProperty(value = "体重（kg）", example = "70.2", required = true)
//    @NotNull(message = "体重不能为空")
//    @Positive(message = "体重必须大于0")
    private Float weight;

    @ApiModelProperty(value = "高压（收缩压，单位：mmHg）", example = "120", required = false)
//    @Positive(message = "高压必须大于0")
    private Integer bloodPressureHigh;

    @ApiModelProperty(value = "低压（舒张压，单位：mmHg）", example = "80", required = false)
//    @Positive(message = "低压必须大于0")
    private Integer bloodPressureLow;

    @ApiModelProperty(value = "血糖水平（单位：mmol/L）", example = "5.6", required = false)
//    @Positive(message = "血糖水平必须大于0")
    private Float bloodSugar;

    @ApiModelProperty(value = "胆固醇水平（单位：mmol/L）", example = "4.5", required = false)
//    @Positive(message = "胆固醇水平必须大于0")
    private Float cholesterolLevel;

    @ApiModelProperty(value = "心率（单位：次/分钟）", example = "75", required = false)
//    @Positive(message = "心率必须大于0")
    private Integer heartRate;

    @ApiModelProperty(value = "体脂率（%）", example = "18.5", required = false)
//    @Positive(message = "体脂率必须大于0")
    private Float bodyFatPercentage;

    @ApiModelProperty(value = "腰围（cm）", example = "80.0", required = false)
//    @Positive(message = "腰围必须大于0")
    private Float waistCircumference;

    @ApiModelProperty(value = "臀围（cm）", example = "90.0", required = false)
//    @Positive(message = "臀围必须大于0")
    private Float hipCircumference;

    @ApiModelProperty(value = "腰臀比（WHR，腰围/臀围）", example = "0.89", required = false)
//    @Positive(message = "腰臀比必须大于0")
    private Float whr;

    @ApiModelProperty(value = "吸烟状态", example = "从不吸烟", required = false)
    private String smokingStatus;

    @ApiModelProperty(value = "饮酒状态", example = "偶尔饮酒", required = false)
    private String alcoholConsumption;

    @ApiModelProperty(value = "活动水平 (1: 久坐, 2: 轻度活动, 3: 中度活动, 4: 重度活动)", example = "2", required = true)
//    @Min(value = 1, message = "活动水平必须在1-4之间")
//    @Max(value = 4, message = "活动水平必须在1-4之间")
    private Integer activityLevel;

    @ApiModelProperty(value = "平均每日睡眠时间（小时）", example = "7.5", required = false)
//    @Positive(message = "每日睡眠时间必须大于0")
    private Float sleepHoursPerDay;

    @ApiModelProperty(value = "每日卡路里目标", example = "2000", required = false)
//    @Positive(message = "每日卡路里目标必须大于0")
    private Integer dailyCalorieTarget;

    @ApiModelProperty(value = "健康目标", example = "减重", required = true)
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

    public @NotBlank(message = "性别不能为空") Integer getGender() {
        return gender;
    }

    public void setGender(@NotBlank(message = "性别不能为空") Integer gender) {
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

    public @NotNull(message = "用户ID不能为空") Long getUserId() {
        return userId;
    }

    public void setUserId(@NotNull(message = "用户ID不能为空") Long userId) {
        this.userId = userId;
    }

    public @NotBlank(message = "用户姓名不能为空") String getName() {
        return name;
    }

    public void setName(@NotBlank(message = "用户姓名不能为空") String name) {
        this.name = name;
    }

    public @Positive(message = "高压必须大于0") Integer getBloodPressureHigh() {
        return bloodPressureHigh;
    }

    public void setBloodPressureHigh(@Positive(message = "高压必须大于0") Integer bloodPressureHigh) {
        this.bloodPressureHigh = bloodPressureHigh;
    }

    public @Positive(message = "低压必须大于0") Integer getBloodPressureLow() {
        return bloodPressureLow;
    }

    public void setBloodPressureLow(@Positive(message = "低压必须大于0") Integer bloodPressureLow) {
        this.bloodPressureLow = bloodPressureLow;
    }

    public @Positive(message = "血糖水平必须大于0") Float getBloodSugar() {
        return bloodSugar;
    }

    public void setBloodSugar(@Positive(message = "血糖水平必须大于0") Float bloodSugar) {
        this.bloodSugar = bloodSugar;
    }

    public @Positive(message = "胆固醇水平必须大于0") Float getCholesterolLevel() {
        return cholesterolLevel;
    }

    public void setCholesterolLevel(@Positive(message = "胆固醇水平必须大于0") Float cholesterolLevel) {
        this.cholesterolLevel = cholesterolLevel;
    }

    public @Positive(message = "心率必须大于0") Integer getHeartRate() {
        return heartRate;
    }

    public void setHeartRate(@Positive(message = "心率必须大于0") Integer heartRate) {
        this.heartRate = heartRate;
    }

    public @Positive(message = "体脂率必须大于0") Float getBodyFatPercentage() {
        return bodyFatPercentage;
    }

    public void setBodyFatPercentage(@Positive(message = "体脂率必须大于0") Float bodyFatPercentage) {
        this.bodyFatPercentage = bodyFatPercentage;
    }

    public @Positive(message = "腰围必须大于0") Float getWaistCircumference() {
        return waistCircumference;
    }

    public void setWaistCircumference(@Positive(message = "腰围必须大于0") Float waistCircumference) {
        this.waistCircumference = waistCircumference;
    }

    public @Positive(message = "臀围必须大于0") Float getHipCircumference() {
        return hipCircumference;
    }

    public void setHipCircumference(@Positive(message = "臀围必须大于0") Float hipCircumference) {
        this.hipCircumference = hipCircumference;
    }

    public @Positive(message = "腰臀比必须大于0") Float getWhr() {
        return whr;
    }

    public void setWhr(@Positive(message = "腰臀比必须大于0") Float whr) {
        this.whr = whr;
    }

    public String getSmokingStatus() {
        return smokingStatus;
    }

    public void setSmokingStatus(String smokingStatus) {
        this.smokingStatus = smokingStatus;
    }

    public String getAlcoholConsumption() {
        return alcoholConsumption;
    }

    public void setAlcoholConsumption(String alcoholConsumption) {
        this.alcoholConsumption = alcoholConsumption;
    }

    public @Positive(message = "每日睡眠时间必须大于0") Float getSleepHoursPerDay() {
        return sleepHoursPerDay;
    }

    public void setSleepHoursPerDay(@Positive(message = "每日睡眠时间必须大于0") Float sleepHoursPerDay) {
        this.sleepHoursPerDay = sleepHoursPerDay;
    }

    public @Positive(message = "每日卡路里目标必须大于0") Integer getDailyCalorieTarget() {
        return dailyCalorieTarget;
    }

    public void setDailyCalorieTarget(@Positive(message = "每日卡路里目标必须大于0") Integer dailyCalorieTarget) {
        this.dailyCalorieTarget = dailyCalorieTarget;
    }
}