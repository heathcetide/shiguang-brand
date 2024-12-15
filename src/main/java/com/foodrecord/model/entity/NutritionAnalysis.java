package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import java.time.LocalDate;


@TableName("nutrition_analysis")
public class NutritionAnalysis extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("user_id")
    private Long userId;
    
    @TableField("analysis_date")
    private LocalDate analysisDate;
    
    @TableField("protein_balance")
    private Float proteinBalance;  // 蛋白质均衡度
    
    @TableField("fat_balance")
    private Float fatBalance;  // 脂肪均衡度
    
    @TableField("carb_balance")
    private Float carbBalance;  // 碳水均衡度
    
    @TableField("vitamin_balance")
    private Float vitaminBalance;  // 维生素均衡度
    
    @TableField("mineral_balance")
    private Float mineralBalance;  // 矿物质均衡度
    
    @TableField("overall_balance")
    private Float overallBalance;  // 总体均衡度
    
    @TableField("nutrition_suggestions")
    private String nutritionSuggestions;  // 营养建议
    
    @TableField("health_warnings")
    private String healthWarnings;  // 健康警告
    
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