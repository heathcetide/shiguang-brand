package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import java.time.LocalDateTime;
import java.util.Date;

@ApiModel(description = "用户库存实体类")
@TableName("user_inventory")
public class UserInventory {

    @ApiModelProperty(value = "库存记录主键", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "1001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "食物ID（关联food_basic表，可为空）", example = "101")
    @TableField("food_id")
    private Long foodId;

    @ApiModelProperty(value = "自定义食物名称", example = "自制草莓果酱")
    @TableField("custom_food_name")
    private String customFoodName;

    @ApiModelProperty(value = "库存数量（重量、个数等）", example = "2.5")
    @TableField("quantity")
    private Float quantity;

    @ApiModelProperty(value = "单位（如克、毫升、个等）", example = "kg")
    @TableField("unit")
    private String unit;

    @ApiModelProperty(value = "保质期", example = "2024-12-31")
    @TableField("expiration_date")
    private Date expirationDate;

    @ApiModelProperty(value = "采购日期", example = "2024-12-15")
    @TableField("purchase_date")
    private Date purchaseDate;

    @ApiModelProperty(value = "上次使用日期", example = "2024-12-20")
    @TableField("last_used_date")
    private Date lastUsedDate;

    @ApiModelProperty(value = "食物来源", example = "超市")
    @TableField("source")
    private String source;

    @ApiModelProperty(value = "用途分类", example = "主食")
    @TableField("usage_category")
    private String usageCategory;

    @ApiModelProperty(value = "是否可用", example = "1")
    @TableField("is_available")
    private Boolean isAvailable;

    @ApiModelProperty(value = "存储位置", example = "冰箱冷藏区")
    @TableField("storage_location")
    private String storageLocation;

    @ApiModelProperty(value = "备注信息", example = "需尽快食用")
    @TableField("notes")
    private String notes;

    @ApiModelProperty(value = "提醒阈值", example = "1.0")
    @TableField("alert_threshold")
    private Float alertThreshold;

    @ApiModelProperty(value = "记录创建时间", example = "2024-12-01 10:00:00")
    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @ApiModelProperty(value = "记录更新时间", example = "2024-12-01 10:00:00")
    @TableField(value = "updated_at", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @ApiModelProperty(value = "逻辑删除标志", example = "0")
    @TableField("deleted")
    private Boolean deleted;

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

    public Date getExpirationDate() {
        return expirationDate;
    }

    public void setExpirationDate(Date expirationDate) {
        this.expirationDate = expirationDate;
    }

    public Date getPurchaseDate() {
        return purchaseDate;
    }

    public void setPurchaseDate(Date purchaseDate) {
        this.purchaseDate = purchaseDate;
    }

    public Date getLastUsedDate() {
        return lastUsedDate;
    }

    public void setLastUsedDate(Date lastUsedDate) {
        this.lastUsedDate = lastUsedDate;
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

    public Boolean getAvailable() {
        return isAvailable;
    }

    public void setAvailable(Boolean available) {
        isAvailable = available;
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

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Boolean getDeleted() {
        return deleted;
    }

    public void setDeleted(Boolean deleted) {
        this.deleted = deleted;
    }
}
