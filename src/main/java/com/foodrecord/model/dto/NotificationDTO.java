package com.foodrecord.model.dto;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.model.enums.NotificationLevel;
import com.foodrecord.model.enums.NotificationType;
import java.time.LocalDateTime;

/**
 * 通知DTO
 */

public class NotificationDTO {
    private Long id;
    private NotificationType type;
    private String title;
    private String content;
    private NotificationLevel level;
    private boolean read;
    private Long businessId;
    private String businessType;
    private String extraData;
    private LocalDateTime sendTime;
    private LocalDateTime readTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public NotificationType getType() {
        return type;
    }

    public void setType(NotificationType type) {
        this.type = type;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public NotificationLevel getLevel() {
        return level;
    }

    public void setLevel(NotificationLevel level) {
        this.level = level;
    }

    public boolean isRead() {
        return read;
    }

    public void setRead(boolean read) {
        this.read = read;
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

    public LocalDateTime getSendTime() {
        return sendTime;
    }

    public void setSendTime(LocalDateTime sendTime) {
        this.sendTime = sendTime;
    }

    public LocalDateTime getReadTime() {
        return readTime;
    }

    public void setReadTime(LocalDateTime readTime) {
        this.readTime = readTime;
    }

    /**
     * 从实体转换为DTO
     */
    public static NotificationDTO from(Notification notification) {
        NotificationDTO dto = new NotificationDTO();
        dto.setId(notification.getId());
        dto.setType(notification.getType());
        dto.setTitle(notification.getTitle());
        dto.setContent(notification.getContent());
        dto.setLevel(notification.getLevel());
        dto.setRead(notification.isRead());
        dto.setBusinessId(notification.getBusinessId());
        dto.setBusinessType(notification.getBusinessType());
        dto.setExtraData(notification.getExtraData());
        dto.setSendTime(notification.getSendTime());
        dto.setReadTime(notification.getReadTime());
        return dto;
    }
} 