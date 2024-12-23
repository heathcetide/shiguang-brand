package com.foodrecord.model.entity.user;

import com.baomidou.mybatisplus.annotation.*;
import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.io.Serializable;
import java.time.LocalDate;

@TableName("user_health_data")
@ApiModel(value = "UserHealthData", description = "用户健康数据实体类")
public class UserHealthData implements Serializable {

    private static final long serialVersionUID = 1L; // 添加 serialVersionUID

    @ApiModelProperty(value = "主键ID", example = "1")
    @TableId
    private Long id;

    @ApiModelProperty(value = "用户ID（唯一标识）", example = "1001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "用户姓名", example = "张三")
    @TableField("name")
    private String name;

    @ApiModelProperty(value = "性别（0 = 女，1 = 男）", example = "1")
    @TableField("gender")
    private Integer gender;

    @ApiModelProperty(value = "年龄", example = "30")
    @TableField("age")
    private Integer age;

    @ApiModelProperty(value = "身高（cm）", example = "175.5")
    @TableField("height")
    private Float height;

    @ApiModelProperty(value = "体重（kg）", example = "70.2")
    @TableField("weight")
    private Float weight;

    @ApiModelProperty(value = "高压（收缩压，单位：mmHg）", example = "120")
    @TableField("blood_pressure_high")
    private Integer bloodPressureHigh;

    @ApiModelProperty(value = "低压（舒张压，单位：mmHg）", example = "80")
    @TableField("blood_pressure_low")
    private Integer bloodPressureLow;

    @ApiModelProperty(value = "血糖水平（单位：mmol/L）", example = "5.6")
    @TableField("blood_sugar")
    private Float bloodSugar;

    @ApiModelProperty(value = "胆固醇水平（单位：mmol/L）", example = "4.5")
    @TableField("cholesterol_level")
    private Float cholesterolLevel;

    @ApiModelProperty(value = "心率（单位：次/分钟）", example = "75")
    @TableField("heart_rate")
    private Integer heartRate;

    @ApiModelProperty(value = "BMI指数（体重除以身高平方）", example = "22.8")
    @TableField(exist = false)
    private Float bmi;

    @ApiModelProperty(value = "体脂率（%）", example = "18.5")
    @TableField("body_fat_percentage")
    private Float bodyFatPercentage;

    @ApiModelProperty(value = "腰围（cm）", example = "80.0")
    @TableField("waist_circumference")
    private Float waistCircumference;

    @ApiModelProperty(value = "臀围（cm）", example = "90.0")
    @TableField("hip_circumference")
    private Float hipCircumference;

    @ApiModelProperty(value = "腰臀比（WHR，腰围/臀围）", example = "0.89")
    @TableField(exist = false)
    private Float whr;

    @ApiModelProperty(value = "吸烟状态", example = "从不吸烟")
    @TableField("smoking_status")
    private String smokingStatus;

    @ApiModelProperty(value = "饮酒状态", example = "偶尔饮酒")
    @TableField("alcohol_consumption")
    private String alcoholConsumption;

    @ApiModelProperty(value = "活动水平 (1: 久坐, 2: 轻度活动, 3: 中度活动, 4: 重度活动)", example = "2")
    @TableField("activity_level")
    private Integer activityLevel;

    @ApiModelProperty(value = "平均每日睡眠时间（小时）", example = "7.5")
    @TableField("sleep_hours_per_day")
    private Float sleepHoursPerDay;

    @ApiModelProperty(value = "每日卡路里目标", example = "2000")
    @TableField("daily_calorie_target")
    private Integer dailyCalorieTarget;

    @ApiModelProperty(value = "数据最后更新时间（精确到天）", example = "2024-12-22")
    @TableField("last_updated_date")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    private LocalDate lastUpdatedDate;

    @ApiModelProperty(value = "创建时间（精确到天）", example = "2024-01-01")
    @TableField("created_at")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    private LocalDate createdAt;

    @ApiModelProperty(value = "关联的用户实体")
    @TableField(exist = false)
    private transient User user;

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

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }
}