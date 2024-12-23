package com.foodrecord.notification.impl;

import com.foodrecord.notification.NotificationChannel;
import org.springframework.stereotype.Component;

@Component
public class VoiceNotificationChannel implements NotificationChannel {

    @Override
    public void sendTimingMessage(Long userId, String message) {
        String phoneNumber = getUserPhoneNumber(userId);
        if (phoneNumber == null) {
            System.out.printf("用户 %d 未绑定手机号，无法发送语音通知%n", userId);
            return;
        }

        System.out.printf("语音通知发送给用户 %d: %s%n", userId, message);

        // 模拟调用语音服务
        sendVoiceNotification(phoneNumber, message);
    }

    private String getUserPhoneNumber(Long userId) {
        // 模拟从数据库或缓存中获取用户手机号
        return "135XXXX5678";
    }

    private void sendVoiceNotification(String phoneNumber, String message) {
        // 调用语音服务的 API，比如阿里云语音、Twilio
        System.out.printf("通过手机号 %s 发送语音消息: %s%n", phoneNumber, message);
    }
}
