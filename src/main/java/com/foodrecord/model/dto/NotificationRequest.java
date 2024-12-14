package com.foodrecord.model.dto;

import com.foodrecord.model.enums.NotificationLevel;
import com.foodrecord.model.enums.NotificationType;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

/**
 * 通知请求DTO
 */
public class NotificationRequest {
    @NotNull(message = "用户ID不能为空")
    private Long userId;
    
    @NotNull(message = "通知类型不能为空")
    private NotificationType type;
    
    @NotBlank(message = "标题不能为空")
    private String title;
    
    @NotBlank(message = "内容不能为空")
    private String content;
    
    private NotificationLevel level = NotificationLevel.NORMAL;
    
    private Long businessId;
    
    private String businessType;
    
    private String extraData;

    public @NotNull(message = "用户ID不能为空") Long getUserId() {
        return userId;
    }

    public void setUserId(@NotNull(message = "用户ID不能为空") Long userId) {
        this.userId = userId;
    }

    public @NotNull(message = "通知类型不能为空") NotificationType getType() {
        return type;
    }

    public void setType(@NotNull(message = "通知类型不能为空") NotificationType type) {
        this.type = type;
    }

    public @NotBlank(message = "标题不能为空") String getTitle() {
        return title;
    }

    public void setTitle(@NotBlank(message = "标题不能为空") String title) {
        this.title = title;
    }

    public @NotBlank(message = "内容不能为空") String getContent() {
        return content;
    }

    public void setContent(@NotBlank(message = "内容不能为空") String content) {
        this.content = content;
    }

    public NotificationLevel getLevel() {
        return level;
    }

    public void setLevel(NotificationLevel level) {
        this.level = level;
    }

    public Long getBusinessId() {
        return businessId;
    }

    public void setBusinessId(Long businessId) {
        this.businessId = businessId;
    }

    public String getBusinessType() {
        return businessType;
    }

    public void setBusinessType(String businessType) {
        this.businessType = businessType;
    }

    public String getExtraData() {
        return extraData;
    }

    public void setExtraData(String extraData) {
        this.extraData = extraData;
    }
}