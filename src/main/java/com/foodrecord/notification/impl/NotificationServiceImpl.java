package com.foodrecord.notification.impl;

import com.foodrecord.mapper.NotificationMapper;
import com.foodrecord.model.dto.NotificationQuery;
import com.foodrecord.model.entity.Notification;
import com.foodrecord.notification.EmailNotificationService;
import com.foodrecord.notification.NotificationChannel;
import com.foodrecord.notification.NotificationService;
import com.foodrecord.service.UserPreferenceService;
import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 消息通知服务
 */
@Service
public class NotificationServiceImpl implements NotificationService {

    @Resource
    private NotificationMapper notificationMapper;

    @Resource
    private EmailNotificationService emailNotificationService;

    @Autowired
    private UserPreferenceService userPreferenceService;
    /**
     * 发送通知
     */
    @Override
    public void sendNotification(Notification notification) {
        // 1. 保存通知记录
        notificationMapper.save(notification);
        
        // 2. 发送通知
//        notificationSender.send(notification);
    }
    
    /**
     * 获取用户未读通知
     */
    @Override
    public List<Notification> getUnreadNotifications(Long userId) {
        return notificationMapper.findUnreadByUserId(userId);
    }
    
    /**
     * 标记通知为已读
     */
    @Override
    public void markAsRead(Long notificationId) {
        notificationMapper.markAsRead(notificationId);
    }
    
    /**
     * 标记所有通知为已读
     */
    @Override
    public void markAllAsRead(Long userId) {
        notificationMapper.markAllAsRead(userId);
    }
    
    /**
     * 删除通知
     */
    @Override
    public void deleteNotification(Long notificationId) {
        notificationMapper.deleteById(notificationId);
    }


    public PageInfo<Notification> queryNotifications(NotificationQuery query) {
        PageHelper.startPage(query.getPageNum(), query.getPageSize());
        List<Notification> notifications = notificationMapper.queryNotifications(query);
        return new PageInfo<>(notifications);
    }


    private final Map<String, NotificationChannel> channelMap = new ConcurrentHashMap<>();

    @Autowired
    public NotificationServiceImpl(List<NotificationChannel> channels) {
        // 将所有实现 NotificationChannel 的组件注入到 Map 中
        channels.forEach(channel -> channelMap.put(channel.getClass().getSimpleName(), channel));
    }

    /**
     * 按指定方式发送通知
     * @param channelType 推送方式 (如 "SmsNotificationChannel", "PushNotificationChannel")
     * @param userId 用户ID
     * @param message 消息内容
     */
    public void sendTimingNotification(String channelType, Long userId, String message) {
        NotificationChannel channel = channelMap.get(channelType);
        if (channel != null) {
            channel.sendTimingMessage(userId, message);
        } else {
            throw new IllegalArgumentException("未知的推送方式: " + channelType);
        }
    }

    /**
     * 动态根据用户推送偏好发送通知
     *
     * @param userId  用户ID
     * @param message 消息内容
     */
    public void sendNotificationBasedOnPreference(Long userId, String message) {
        String preferredChannel = userPreferenceService.getUserPreferredChannel(userId);
        String userName = userPreferenceService.getUserName(userId);
        String personalizedMessage = String.format("您好，%s，%s", userName, message);

        sendTimingNotification(preferredChannel, userId, personalizedMessage);
    }
} 