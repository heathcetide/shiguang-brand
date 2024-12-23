package com.foodrecord.notification;

import com.foodrecord.model.dto.NotificationQuery;
import com.foodrecord.model.entity.Notification;
import com.github.pagehelper.PageInfo;

import java.util.List;

public interface NotificationService {
    void sendNotification(Notification notification);

    List<Notification> getUnreadNotifications(Long userId);

    void markAsRead(Long notificationId);

    void markAllAsRead(Long userId);

    void deleteNotification(Long notificationId);

    PageInfo<Notification> queryNotifications(NotificationQuery query);

    void sendNotificationBasedOnPreference(Long userId, String message);

    void sendTimingNotification(String channelType, Long userId, String message);
}
