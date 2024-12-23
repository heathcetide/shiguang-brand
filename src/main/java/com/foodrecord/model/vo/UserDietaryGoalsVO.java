package com.foodrecord.model.vo;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.foodrecord.model.entity.user.UserDietaryGoals;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.io.Serializable;
import java.util.Date;

@ApiModel(description = "用户饮食目标VO")
public class UserDietaryGoalsVO implements Serializable {

    @ApiModelProperty(value = "目标记录ID", example = "1")
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    private Long userId;

    @ApiModelProperty(value = "目标分类", example = "减重", allowableValues = "减重, 减脂, 增重, 降血压, 升血压, 健康维持, 其他")
    private String goalCategory;

    @ApiModelProperty(value = "目标体重（kg）", example = "65.0")
    private Float targetWeight;

    @ApiModelProperty(value = "目标高压（收缩压，单位：mmHg）", example = "120")
    private Integer targetBloodPressureHigh;

    @ApiModelProperty(value = "目标低压（舒张压，单位：mmHg）", example = "80")
    private Integer targetBloodPressureLow;

    @ApiModelProperty(value = "目标血糖水平（单位：mmol/L）", example = "5.5")
    private Float targetBloodSugar;

    @ApiModelProperty(value = "目标体脂率（%）", example = "18.0")
    private Float targetBodyFat;

    @ApiModelProperty(value = "目标蛋白质摄入（g）", example = "100.0")
    private Float targetProtein;

    @ApiModelProperty(value = "目标脂肪摄入（g）", example = "50.0")
    private Float targetFat;

    @ApiModelProperty(value = "目标碳水摄入（g）", example = "250.0")
    private Float targetCarb;

    @ApiModelProperty(value = "目标纤维摄入（g）", example = "30.0")
    private Float targetFiber;

    @ApiModelProperty(value = "备注信息（目标说明或医生建议）", example = "减少高血压风险")
    private String notes;

    @ApiModelProperty(value = "目标开始日期", example = "2024-01-01")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "Asia/Shanghai")
    private Date startDate;

    @ApiModelProperty(value = "目标结束日期", example = "2024-12-31")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "Asia/Shanghai")
    private Date endDate;

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

    public String getGoalCategory() {
        return goalCategory;
    }

    public void setGoalCategory(String goalCategory) {
        this.goalCategory = goalCategory;
    }

    public Float getTargetWeight() {
        return targetWeight;
    }

    public void setTargetWeight(Float targetWeight) {
        this.targetWeight = targetWeight;
    }

    public Integer getTargetBloodPressureHigh() {
        return targetBloodPressureHigh;
    }

    public void setTargetBloodPressureHigh(Integer targetBloodPressureHigh) {
        this.targetBloodPressureHigh = targetBloodPressureHigh;
    }

    public Integer getTargetBloodPressureLow() {
        return targetBloodPressureLow;
    }

    public void setTargetBloodPressureLow(Integer targetBloodPressureLow) {
        this.targetBloodPressureLow = targetBloodPressureLow;
    }

    public Float getTargetBloodSugar() {
        return targetBloodSugar;
    }

    public void setTargetBloodSugar(Float targetBloodSugar) {
        this.targetBloodSugar = targetBloodSugar;
    }

    public Float getTargetBodyFat() {
        return targetBodyFat;
    }

    public void setTargetBodyFat(Float targetBodyFat) {
        this.targetBodyFat = targetBodyFat;
    }

    public Float getTargetProtein() {
        return targetProtein;
    }

    public void setTargetProtein(Float targetProtein) {
        this.targetProtein = targetProtein;
    }

    public Float getTargetFat() {
        return targetFat;
    }

    public void setTargetFat(Float targetFat) {
        this.targetFat = targetFat;
    }

    public Float getTargetCarb() {
        return targetCarb;
    }

    public void setTargetCarb(Float targetCarb) {
        this.targetCarb = targetCarb;
    }

    public Float getTargetFiber() {
        return targetFiber;
    }

    public void setTargetFiber(Float targetFiber) {
        this.targetFiber = targetFiber;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public Date getStartDate() {
        return startDate;
    }

    public void setStartDate(Date startDate) {
        this.startDate = startDate;
    }

    public Date getEndDate() {
        return endDate;
    }

    public void setEndDate(Date endDate) {
        this.endDate = endDate;
    }

    public  UserDietaryGoalsVO toUserDietaryGoalsVO(UserDietaryGoals entity) {
        if (entity == null) {
            return null;
        }

        UserDietaryGoalsVO vo = new UserDietaryGoalsVO();
        vo.setId(entity.getId());
        vo.setUserId(entity.getUserId());
        vo.setGoalCategory(entity.getGoalCategory());
        vo.setTargetWeight(entity.getTargetWeight());
        vo.setTargetBloodPressureHigh(entity.getTargetBloodPressureHigh());
        vo.setTargetBloodPressureLow(entity.getTargetBloodPressureLow());
        vo.setTargetBloodSugar(entity.getTargetBloodSugar());
        vo.setTargetBodyFat(entity.getTargetBodyFat());
        vo.setTargetProtein(entity.getTargetProtein());
        vo.setTargetFat(entity.getTargetFat());
        vo.setTargetCarb(entity.getTargetCarb());
        vo.setTargetFiber(entity.getTargetFiber());
        vo.setNotes(entity.getNotes());
        vo.setStartDate(entity.getStartDate());
        vo.setEndDate(entity.getEndDate());
        return vo;
    }
}
