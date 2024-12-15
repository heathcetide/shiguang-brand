package com.foodrecord.common.security.event;

import org.springframework.context.ApplicationEvent;

/**
 * 安全事件基类
 * 所有安全相关事件的父类
 * 
 * @author yourname
 * @since 1.0.0
 */
public abstract class SecurityEvent extends ApplicationEvent {
    private final Long userId;
    private final String eventType;
    private final String detail;
    private final String ipAddress;
    
    public SecurityEvent(Object source, Long userId, String eventType, String detail, String ipAddress) {
        super(source);
        this.userId = userId;
        this.eventType = eventType;
        this.detail = detail;
        this.ipAddress = ipAddress;
    }

    public Long getUserId() {
        return userId;
    }

    public String getEventType() {
        return eventType;
    }

    public String getDetail() {
        return detail;
    }

    public String getIpAddress() {
        return ipAddress;
    }
}