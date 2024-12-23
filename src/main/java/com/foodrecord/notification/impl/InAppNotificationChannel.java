package com.foodrecord.notification.impl;

import com.foodrecord.notification.NotificationChannel;
import org.springframework.stereotype.Component;

@Component
public class InAppNotificationChannel implements NotificationChannel {

    @Override
    public void sendTimingMessage(Long userId, String message) {
        System.out.printf("站内通知发送给用户 %d: %s%n", userId, message);
        // 模拟保存到站内消息表
        saveInAppNotification(userId, message);
    }

    private void saveInAppNotification(Long userId, String message) {
        // 模拟将站内消息保存到数据库
        System.out.printf("站内消息保存到数据库: 用户 %d 消息: %s%n", userId, message);
    }
}
