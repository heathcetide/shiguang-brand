package com.foodrecord.notification;

import com.foodrecord.model.entity.Notification;

/**
 * 通知发送器接口
 */
public interface NotificationSender {
    /**
     * 发送通知
     */
    void send(Notification notification);
} 