package com.foodrecord.risk.notification;

import org.springframework.stereotype.Component;

@Component("riskSmsNotificationChannel")
public class SmsNotificationChannel implements NotificationChannel {

    @Override
    public void send(String content) {
        // TODO: 实现短信发送逻辑
    }

    @Override
    public boolean isAvailable() {
        return true;
    }

    @Override
    public String getChannelType() {
        return "sms";
    }
} 