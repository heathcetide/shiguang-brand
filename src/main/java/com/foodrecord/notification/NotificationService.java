package com.foodrecord.notification;

import com.foodrecord.mapper.NotificationMapper;
import com.foodrecord.model.dto.NotificationQuery;
import com.foodrecord.model.entity.Notification;
import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

/**
 * 消息通知服务
 */
@Service
public class NotificationService {

    @Resource
    private NotificationMapper notificationMapper;

    private final NotificationSender notificationSender;

    public NotificationService(NotificationSender notificationSender) {
        this.notificationSender = notificationSender;
    }

    /**
     * 发送通知
     */
    public void sendNotification(Notification notification) {
        // 1. 保存通知记录
        notificationMapper.save(notification);
        
        // 2. 发送通知
        notificationSender.send(notification);
    }
    
    /**
     * 获取用户未读通知
     */
    public List<Notification> getUnreadNotifications(Long userId) {
        return notificationMapper.findUnreadByUserId(userId);
    }
    
    /**
     * 标记通知为已读
     */
    public void markAsRead(Long notificationId) {
        notificationMapper.markAsRead(notificationId);
    }
    
    /**
     * 标记所有通知为已读
     */
    public void markAllAsRead(Long userId) {
        notificationMapper.markAllAsRead(userId);
    }
    
    /**
     * 删除通知
     */
    public void deleteNotification(Long notificationId) {
        notificationMapper.deleteById(notificationId);
    }


    public PageInfo<Notification> queryNotifications(NotificationQuery query) {
        PageHelper.startPage(query.getPageNum(), query.getPageSize());
        List<Notification> notifications = notificationMapper.queryNotifications(query);
        return new PageInfo<>(notifications);
    }
} 