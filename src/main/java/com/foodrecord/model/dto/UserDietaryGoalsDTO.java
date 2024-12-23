package com.foodrecord.model.dto;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import javax.validation.constraints.*;
import java.io.Serializable;
import java.time.LocalDate;
import java.util.Date;


@ApiModel(description = "用户饮食目标传输对象")
public class UserDietaryGoalsDTO implements Serializable {

    @ApiModelProperty(value = "目标记录ID", example = "1")
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001", required = true)
    @NotNull(message = "用户ID不能为空")
    private Long userId;

    @ApiModelProperty(value = "目标分类（减重、减脂、增重、降血压、升血压、健康维持、其他）", example = "减重", required = true)
    @NotBlank(message = "目标分类不能为空")
    private String goalCategory;

    @ApiModelProperty(value = "目标体重（kg）", example = "65.0")
    @PositiveOrZero(message = "目标体重必须大于等于0")
    private Float targetWeight;

    @ApiModelProperty(value = "目标高压（收缩压，单位：mmHg）", example = "120")
    @PositiveOrZero(message = "目标高压必须大于等于0")
    private Integer targetBloodPressureHigh;

    @ApiModelProperty(value = "目标低压（舒张压，单位：mmHg）", example = "80")
    @PositiveOrZero(message = "目标低压必须大于等于0")
    private Integer targetBloodPressureLow;

    @ApiModelProperty(value = "目标血糖水平（单位：mmol/L）", example = "5.5")
    @PositiveOrZero(message = "目标血糖水平必须大于等于0")
    private Float targetBloodSugar;

    @ApiModelProperty(value = "目标体脂率（%）", example = "18.5")
    @PositiveOrZero(message = "目标体脂率必须大于等于0")
    private Float targetBodyFat;

    @ApiModelProperty(value = "目标蛋白质摄入（g）", example = "100.0", required = true)
    @NotNull(message = "蛋白质目标不能为空")
    @PositiveOrZero(message = "蛋白质目标必须大于等于0")
    private Float targetProtein;

    @ApiModelProperty(value = "目标脂肪摄入（g）", example = "50.0", required = true)
    @NotNull(message = "脂肪目标不能为空")
    @PositiveOrZero(message = "脂肪目标必须大于等于0")
    private Float targetFat;

    @ApiModelProperty(value = "目标碳水化合物摄入（g）", example = "250.0", required = true)
    @NotNull(message = "碳水化合物目标不能为空")
    @PositiveOrZero(message = "碳水化合物目标必须大于等于0")
    private Float targetCarb;

    @ApiModelProperty(value = "目标膳食纤维摄入（g）", example = "30.0", required = true)
    @NotNull(message = "膳食纤维目标不能为空")
    @PositiveOrZero(message = "膳食纤维目标必须大于等于0")
    private Float targetFiber;

    @ApiModelProperty(value = "备注信息（目标说明或医生建议）", example = "医生建议增加蛋白质摄入")
    private String notes;

    @ApiModelProperty(value = "目标开始日期", example = "2024-01-01", required = true)
    @NotNull(message = "目标开始日期不能为空")
    private Date startDate;

    @ApiModelProperty(value = "目标结束日期", example = "2024-12-31")
    private Date endDate;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public @NotNull(message = "用户ID不能为空") Long getUserId() {
        return userId;
    }

    public void setUserId(@NotNull(message = "用户ID不能为空") Long userId) {
        this.userId = userId;
    }

    public @NotBlank(message = "目标分类不能为空") String getGoalCategory() {
        return goalCategory;
    }

    public void setGoalCategory(@NotBlank(message = "目标分类不能为空") String goalCategory) {
        this.goalCategory = goalCategory;
    }

    public @PositiveOrZero(message = "目标体重必须大于等于0") Float getTargetWeight() {
        return targetWeight;
    }

    public void setTargetWeight(@PositiveOrZero(message = "目标体重必须大于等于0") Float targetWeight) {
        this.targetWeight = targetWeight;
    }

    public @PositiveOrZero(message = "目标高压必须大于等于0") Integer getTargetBloodPressureHigh() {
        return targetBloodPressureHigh;
    }

    public void setTargetBloodPressureHigh(@PositiveOrZero(message = "目标高压必须大于等于0") Integer targetBloodPressureHigh) {
        this.targetBloodPressureHigh = targetBloodPressureHigh;
    }

    public @PositiveOrZero(message = "目标低压必须大于等于0") Integer getTargetBloodPressureLow() {
        return targetBloodPressureLow;
    }

    public void setTargetBloodPressureLow(@PositiveOrZero(message = "目标低压必须大于等于0") Integer targetBloodPressureLow) {
        this.targetBloodPressureLow = targetBloodPressureLow;
    }

    public @PositiveOrZero(message = "目标血糖水平必须大于等于0") Float getTargetBloodSugar() {
        return targetBloodSugar;
    }

    public void setTargetBloodSugar(@PositiveOrZero(message = "目标血糖水平必须大于等于0") Float targetBloodSugar) {
        this.targetBloodSugar = targetBloodSugar;
    }

    public @PositiveOrZero(message = "目标体脂率必须大于等于0") Float getTargetBodyFat() {
        return targetBodyFat;
    }

    public void setTargetBodyFat(@PositiveOrZero(message = "目标体脂率必须大于等于0") Float targetBodyFat) {
        this.targetBodyFat = targetBodyFat;
    }

    public @NotNull(message = "蛋白质目标不能为空") @PositiveOrZero(message = "蛋白质目标必须大于等于0") Float getTargetProtein() {
        return targetProtein;
    }

    public void setTargetProtein(@NotNull(message = "蛋白质目标不能为空") @PositiveOrZero(message = "蛋白质目标必须大于等于0") Float targetProtein) {
        this.targetProtein = targetProtein;
    }

    public @NotNull(message = "脂肪目标不能为空") @PositiveOrZero(message = "脂肪目标必须大于等于0") Float getTargetFat() {
        return targetFat;
    }

    public void setTargetFat(@NotNull(message = "脂肪目标不能为空") @PositiveOrZero(message = "脂肪目标必须大于等于0") Float targetFat) {
        this.targetFat = targetFat;
    }

    public @NotNull(message = "碳水化合物目标不能为空") @PositiveOrZero(message = "碳水化合物目标必须大于等于0") Float getTargetCarb() {
        return targetCarb;
    }

    public void setTargetCarb(@NotNull(message = "碳水化合物目标不能为空") @PositiveOrZero(message = "碳水化合物目标必须大于等于0") Float targetCarb) {
        this.targetCarb = targetCarb;
    }

    public @NotNull(message = "膳食纤维目标不能为空") @PositiveOrZero(message = "膳食纤维目标必须大于等于0") Float getTargetFiber() {
        return targetFiber;
    }

    public void setTargetFiber(@NotNull(message = "膳食纤维目标不能为空") @PositiveOrZero(message = "膳食纤维目标必须大于等于0") Float targetFiber) {
        this.targetFiber = targetFiber;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public @NotNull(message = "目标开始日期不能为空") Date getStartDate() {
        return startDate;
    }

    public void setStartDate(@NotNull(message = "目标开始日期不能为空") Date startDate) {
        this.startDate = startDate;
    }

    public Date getEndDate() {
        return endDate;
    }

    public void setEndDate(Date endDate) {
        this.endDate = endDate;
    }
}