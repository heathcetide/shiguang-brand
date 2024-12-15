package com.foodrecord.model.entity;

import com.foodrecord.model.enums.WarningLevel;


/**
 * 健康警告
 */
public class HealthWarning {
    // 警告类型
    private String warningType;
    
    // 警告级别
    private WarningLevel level;
    
    // 警告描述
    private String description;
    
    // 建议措施
    private String suggestedAction;
    
    // 是否需要就医
    private boolean requireMedicalAttention;

    public String getWarningType() {
        return warningType;
    }

    public void setWarningType(String warningType) {
        this.warningType = warningType;
    }

    public WarningLevel getLevel() {
        return level;
    }

    public void setLevel(WarningLevel level) {
        this.level = level;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getSuggestedAction() {
        return suggestedAction;
    }

    public void setSuggestedAction(String suggestedAction) {
        this.suggestedAction = suggestedAction;
    }

    public boolean isRequireMedicalAttention() {
        return requireMedicalAttention;
    }

    public void setRequireMedicalAttention(boolean requireMedicalAttention) {
        this.requireMedicalAttention = requireMedicalAttention;
    }
}