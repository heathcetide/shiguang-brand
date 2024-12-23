package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import java.time.LocalDate;


import com.foodrecord.model.entity.user.User;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "营养分析实体")
@TableName("nutrition_analysis")
public class NutritionAnalysis extends BaseEntity {

    @ApiModelProperty(value = "营养分析记录ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "分析日期", example = "2024-12-16")
    @TableField("analysis_date")
    private LocalDate analysisDate;

    @ApiModelProperty(value = "蛋白质均衡度", example = "80.0")
    @TableField("protein_balance")
    private Float proteinBalance;

    @ApiModelProperty(value = "脂肪均衡度", example = "70.5")
    @TableField("fat_balance")
    private Float fatBalance;

    @ApiModelProperty(value = "碳水均衡度", example = "75.0")
    @TableField("carb_balance")
    private Float carbBalance;

    @ApiModelProperty(value = "维生素均衡度", example = "90.0")
    @TableField("vitamin_balance")
    private Float vitaminBalance;

    @ApiModelProperty(value = "矿物质均衡度", example = "85.0")
    @TableField("mineral_balance")
    private Float mineralBalance;

    @ApiModelProperty(value = "总体均衡度", example = "80.0")
    @TableField("overall_balance")
    private Float overallBalance;

    @ApiModelProperty(value = "营养建议", example = "增加蛋白质摄入")
    @TableField("nutrition_suggestions")
    private String nutritionSuggestions;

    @ApiModelProperty(value = "健康警告", example = "钠摄入过高")
    @TableField("health_warnings")
    private String healthWarnings;

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

    public LocalDate getAnalysisDate() {
        return analysisDate;
    }

    public void setAnalysisDate(LocalDate analysisDate) {
        this.analysisDate = analysisDate;
    }

    public Float getProteinBalance() {
        return proteinBalance;
    }

    public void setProteinBalance(Float proteinBalance) {
        this.proteinBalance = proteinBalance;
    }

    public Float getFatBalance() {
        return fatBalance;
    }

    public void setFatBalance(Float fatBalance) {
        this.fatBalance = fatBalance;
    }

    public Float getCarbBalance() {
        return carbBalance;
    }

    public void setCarbBalance(Float carbBalance) {
        this.carbBalance = carbBalance;
    }

    public Float getVitaminBalance() {
        return vitaminBalance;
    }

    public void setVitaminBalance(Float vitaminBalance) {
        this.vitaminBalance = vitaminBalance;
    }

    public Float getMineralBalance() {
        return mineralBalance;
    }

    public void setMineralBalance(Float mineralBalance) {
        this.mineralBalance = mineralBalance;
    }

    public Float getOverallBalance() {
        return overallBalance;
    }

    public void setOverallBalance(Float overallBalance) {
        this.overallBalance = overallBalance;
    }

    public String getNutritionSuggestions() {
        return nutritionSuggestions;
    }

    public void setNutritionSuggestions(String nutritionSuggestions) {
        this.nutritionSuggestions = nutritionSuggestions;
    }

    public String getHealthWarnings() {
        return healthWarnings;
    }

    public void setHealthWarnings(String healthWarnings) {
        this.healthWarnings = healthWarnings;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }
}