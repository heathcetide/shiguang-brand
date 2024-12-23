package com.foodrecord.notification.impl;

import com.foodrecord.notification.NotificationChannel;
import org.springframework.stereotype.Component;

@Component
public class PushNotificationChannel implements NotificationChannel {

    @Override
    public void sendTimingMessage(Long userId, String message) {
        String deviceToken = getUserDeviceToken(userId);
        if (deviceToken == null) {
            System.out.printf("用户 %d 未绑定设备 token，无法发送推送%n", userId);
            return;
        }

        System.out.printf("PUSH 推送给用户 %d: %s%n", userId, message);

        // 模拟调用推送服务
        sendPushNotification(deviceToken, message);
    }

    private String getUserDeviceToken(Long userId) {
        // 模拟从数据库或缓存中获取用户设备 token
        return "device_token_example";
    }

    private void sendPushNotification(String deviceToken, String message) {
        // 调用推送服务的 API，比如 Firebase、APNs
        System.out.printf("通过设备 token %s 发送 PUSH 消息: %s%n", deviceToken, message);
    }
}
