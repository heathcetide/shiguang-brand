package com.foodrecord.model.dto;

public class UserInventoryDTO {
    private Long userId;
    private Long foodId;
    private String customFoodName;
    private Float quantity;
    private String unit;
    private String source;
    private String usageCategory;
    private String storageLocation;
    private String notes;
    private Float alertThreshold;

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getFoodId() {
        return foodId;
    }

    public void setFoodId(Long foodId) {
        this.foodId = foodId;
    }

    public String getCustomFoodName() {
        return customFoodName;
    }

    public void setCustomFoodName(String customFoodName) {
        this.customFoodName = customFoodName;
    }

    public Float getQuantity() {
        return quantity;
    }

    public void setQuantity(Float quantity) {
        this.quantity = quantity;
    }

    public String getUnit() {
        return unit;
    }

    public void setUnit(String unit) {
        this.unit = unit;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getUsageCategory() {
        return usageCategory;
    }

    public void setUsageCategory(String usageCategory) {
        this.usageCategory = usageCategory;
    }

    public String getStorageLocation() {
        return storageLocation;
    }

    public void setStorageLocation(String storageLocation) {
        this.storageLocation = storageLocation;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public Float getAlertThreshold() {
        return alertThreshold;
    }

    public void setAlertThreshold(Float alertThreshold) {
        this.alertThreshold = alertThreshold;
    }
}