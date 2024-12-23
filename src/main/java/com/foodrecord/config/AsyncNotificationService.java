package com.foodrecord.config;

import com.foodrecord.notification.NotificationService;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

@Component
public class AsyncNotificationService {

    private final NotificationService notificationService;

    public AsyncNotificationService(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @Async // Spring 提供的异步支持
    public void sendAsyncNotification(String channelType, Long userId, String message) {
        notificationService.sendTimingNotification(channelType, userId, message);
    }

    @Async
    public void sendAsyncNotificationBasedOnPreference(Long userId, String message) {
        notificationService.sendNotificationBasedOnPreference(userId, message);
    }
}
