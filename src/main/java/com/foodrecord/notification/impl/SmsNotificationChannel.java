package com.foodrecord.notification.impl;

import com.foodrecord.notification.NotificationChannel;
import org.springframework.stereotype.Component;

@Component
public class SmsNotificationChannel implements NotificationChannel {

    @Override
    public void sendTimingMessage(Long userId, String message) {
        String phoneNumber = getUserPhoneNumber(userId);
        if (phoneNumber == null) {
            System.out.printf("用户 %d 未绑定手机号，无法发送短信%n", userId);
            return;
        }

        System.out.printf("短信推送给用户 %d: %s%n", userId, message);

        // 模拟调用短信服务
        sendSms(phoneNumber, message);
    }

    private String getUserPhoneNumber(Long userId) {
        // 模拟从数据库或缓存中获取用户手机号
        return "135XXXX5678";
    }

    private void sendSms(String phoneNumber, String message) {
        // 调用短信服务提供商的 API，比如阿里云、Twilio
        System.out.printf("发送短信到 %s: %s%n", phoneNumber, message);
    }
}
