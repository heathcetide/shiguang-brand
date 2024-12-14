package com.foodrecord.model.dto;

import java.time.LocalDate;

public class NutritionAnalysisDTO {
    private Long id;
    private Long userId;
    private LocalDate analysisDate;
    private Float proteinBalance;
    private Float fatBalance;
    private Float carbBalance;
    private Float vitaminBalance;
    private Float mineralBalance;
    private Float overallBalance;
    private String nutritionSuggestions;
    private String healthWarnings;

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
}