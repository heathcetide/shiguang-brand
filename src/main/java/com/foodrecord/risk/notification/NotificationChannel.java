package com.foodrecord.risk.notification;

public interface NotificationChannel {
    void send(String content);
    boolean isAvailable();
    String getChannelType();
} 