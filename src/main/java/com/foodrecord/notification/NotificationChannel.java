package com.foodrecord.notification;

public interface NotificationChannel {
    /**
     * 发送通知
     * @param userId 用户ID
     * @param message 消息内容
     */
    void sendTimingMessage(Long userId, String message);
}
