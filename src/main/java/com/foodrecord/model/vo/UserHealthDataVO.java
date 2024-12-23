package com.foodrecord.model.vo;


import com.fasterxml.jackson.annotation.JsonFormat;
import com.foodrecord.model.entity.user.UserHealthData;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.io.Serializable;
import java.time.LocalDate;

@ApiModel(description = "用户健康数据视图对象")
public class UserHealthDataVO implements Serializable {

    private static final long serialVersionUID = 1L;

    @ApiModelProperty(value = "主键ID", example = "1")
    private Long id;

    @ApiModelProperty(value = "用户ID（唯一标识）", example = "1001")
    private Long userId;

    @ApiModelProperty(value = "用户姓名", example = "张三")
    private String name;

    @ApiModelProperty(value = "性别（0 = 女，1 = 男）", example = "1")
    private Integer gender;

    @ApiModelProperty(value = "年龄", example = "30")
    private Integer age;

    @ApiModelProperty(value = "身高（cm）", example = "175.5")
    private Float height;

    @ApiModelProperty(value = "体重（kg）", example = "70.2")
    private Float weight;

    @ApiModelProperty(value = "高压（收缩压，单位：mmHg）", example = "120")
    private Integer bloodPressureHigh;

    @ApiModelProperty(value = "低压（舒张压，单位：mmHg）", example = "80")
    private Integer bloodPressureLow;

    @ApiModelProperty(value = "血糖水平（单位：mmol/L）", example = "5.6")
    private Float bloodSugar;

    @ApiModelProperty(value = "胆固醇水平（单位：mmol/L）", example = "4.5")
    private Float cholesterolLevel;

    @ApiModelProperty(value = "心率（单位：次/分钟）", example = "75")
    private Integer heartRate;

    @ApiModelProperty(value = "BMI指数（体重除以身高平方）", example = "22.8")
    private Float bmi;

    @ApiModelProperty(value = "体脂率（%）", example = "18.5")
    private Float bodyFatPercentage;

    @ApiModelProperty(value = "腰围（cm）", example = "80.0")
    private Float waistCircumference;

    @ApiModelProperty(value = "臀围（cm）", example = "90.0")
    private Float hipCircumference;

    @ApiModelProperty(value = "腰臀比（WHR，腰围/臀围）", example = "0.89")
    private Float whr;

    @ApiModelProperty(value = "吸烟状态", example = "从不吸烟")
    private String smokingStatus;

    @ApiModelProperty(value = "饮酒状态", example = "偶尔饮酒")
    private String alcoholConsumption;

    @ApiModelProperty(value = "活动水平 (1: 久坐, 2: 轻度活动, 3: 中度活动, 4: 重度活动)", example = "2")
    private Integer activityLevel;

    @ApiModelProperty(value = "平均每日睡眠时间（小时）", example = "7.5")
    private Float sleepHoursPerDay;

    @ApiModelProperty(value = "每日卡路里目标", example = "2000")
    private Integer dailyCalorieTarget;

    @ApiModelProperty(value = "数据最后更新时间（精确到天）", example = "2024-12-22")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "Asia/Shanghai")
    private LocalDate lastUpdatedDate;

    @ApiModelProperty(value = "创建时间（精确到天）", example = "2024-01-01")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "Asia/Shanghai")
    private LocalDate createdAt;

    // Getters and Setters
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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Integer getGender() {
        return gender;
    }

    public void setGender(Integer gender) {
        this.gender = gender;
    }

    public Integer getAge() {
        return age;
    }

    public void setAge(Integer age) {
        this.age = age;
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

    public Integer getBloodPressureHigh() {
        return bloodPressureHigh;
    }

    public void setBloodPressureHigh(Integer bloodPressureHigh) {
        this.bloodPressureHigh = bloodPressureHigh;
    }

    public Integer getBloodPressureLow() {
        return bloodPressureLow;
    }

    public void setBloodPressureLow(Integer bloodPressureLow) {
        this.bloodPressureLow = bloodPressureLow;
    }

    public Float getBloodSugar() {
        return bloodSugar;
    }

    public void setBloodSugar(Float bloodSugar) {
        this.bloodSugar = bloodSugar;
    }

    public Float getCholesterolLevel() {
        return cholesterolLevel;
    }

    public void setCholesterolLevel(Float cholesterolLevel) {
        this.cholesterolLevel = cholesterolLevel;
    }

    public Integer getHeartRate() {
        return heartRate;
    }

    public void setHeartRate(Integer heartRate) {
        this.heartRate = heartRate;
    }

    public Float getBmi() {
        return bmi;
    }

    public void setBmi(Float bmi) {
        this.bmi = bmi;
    }

    public Float getBodyFatPercentage() {
        return bodyFatPercentage;
    }

    public void setBodyFatPercentage(Float bodyFatPercentage) {
        this.bodyFatPercentage = bodyFatPercentage;
    }

    public Float getWaistCircumference() {
        return waistCircumference;
    }

    public void setWaistCircumference(Float waistCircumference) {
        this.waistCircumference = waistCircumference;
    }

    public Float getHipCircumference() {
        return hipCircumference;
    }

    public void setHipCircumference(Float hipCircumference) {
        this.hipCircumference = hipCircumference;
    }

    public Float getWhr() {
        return whr;
    }

    public void setWhr(Float whr) {
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

    public Integer getActivityLevel() {
        return activityLevel;
    }

    public void setActivityLevel(Integer activityLevel) {
        this.activityLevel = activityLevel;
    }

    public Float getSleepHoursPerDay() {
        return sleepHoursPerDay;
    }

    public void setSleepHoursPerDay(Float sleepHoursPerDay) {
        this.sleepHoursPerDay = sleepHoursPerDay;
    }

    public Integer getDailyCalorieTarget() {
        return dailyCalorieTarget;
    }

    public void setDailyCalorieTarget(Integer dailyCalorieTarget) {
        this.dailyCalorieTarget = dailyCalorieTarget;
    }

    public LocalDate getLastUpdatedDate() {
        return lastUpdatedDate;
    }

    public void setLastUpdatedDate(LocalDate lastUpdatedDate) {
        this.lastUpdatedDate = lastUpdatedDate;
    }

    public LocalDate getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDate createdAt) {
        this.createdAt = createdAt;
    }

    public UserHealthDataVO convertToVO(UserHealthData healthData) {
        if (healthData == null) {
            return null;
        }

        UserHealthDataVO vo = new UserHealthDataVO();
        vo.setId(healthData.getId());
        vo.setUserId(healthData.getUserId());
        vo.setName(healthData.getName());
        vo.setGender(healthData.getGender());
        vo.setAge(healthData.getAge());
        vo.setHeight(healthData.getHeight());
        vo.setWeight(healthData.getWeight());
        vo.setBloodPressureHigh(healthData.getBloodPressureHigh());
        vo.setBloodPressureLow(healthData.getBloodPressureLow());
        vo.setBloodSugar(healthData.getBloodSugar());
        vo.setCholesterolLevel(healthData.getCholesterolLevel());
        vo.setHeartRate(healthData.getHeartRate());
        vo.setBmi(healthData.getBmi());
        vo.setBodyFatPercentage(healthData.getBodyFatPercentage());
        vo.setWaistCircumference(healthData.getWaistCircumference());
        vo.setHipCircumference(healthData.getHipCircumference());
        vo.setWhr(healthData.getWhr());
        vo.setSmokingStatus(healthData.getSmokingStatus());
        vo.setAlcoholConsumption(healthData.getAlcoholConsumption());
        vo.setActivityLevel(healthData.getActivityLevel());
        vo.setSleepHoursPerDay(healthData.getSleepHoursPerDay());
        vo.setDailyCalorieTarget(healthData.getDailyCalorieTarget());
        vo.setLastUpdatedDate(healthData.getLastUpdatedDate());
        vo.setCreatedAt(healthData.getCreatedAt());
        return vo;
    }

}

