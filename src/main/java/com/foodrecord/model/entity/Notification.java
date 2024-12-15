package com.foodrecord.model.entity;

import com.foodrecord.model.enums.NotificationLevel;
import com.foodrecord.model.enums.NotificationType;


import java.time.LocalDateTime;

/**
 * 通知实体
 */
public class Notification extends BaseEntity {

    private Long id;
    // 接收用户ID
    private Long userId;
    
    // 通知类型
    private NotificationType type;
    
    // 通知标题
    private String title;
    
    // 通知内容
    private String content;
    
    // 通知级别
    private NotificationLevel level;
    
    // 是否已读
    private boolean read;
    
    // 关联业务ID
    private Long businessId;
    
    // 关联业务类型
    private String businessType;
    
    // 额外数据(JSON)
    private String extraData;
    
    // 发送时间
    private LocalDateTime sendTime;
    
    // 读取时间
    private LocalDateTime readTime;

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
}