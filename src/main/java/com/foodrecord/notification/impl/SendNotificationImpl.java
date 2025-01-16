package com.foodrecord.notification.impl;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.model.enums.NotificationLevel;
import com.foodrecord.notification.SendNotification;
import com.foodrecord.notification.SendNotifyStrategy;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 发送通知实现类
 * 该类实现了 SendNotification 接口，负责创建并发送通知消息。它通过
 * SendNotifyStrategy 来选择具体的发送策略（如邮件、短信等）。
 */
@Service
public class SendNotificationImpl implements SendNotification {

    private SendNotifyStrategy sendNotifyStrategy;

    private Notification notification;

    /**
     * 构造函数注入 SendNotifyStrategy
     * @param sendNotifyStrategy 具体的通知发送策略（如邮件、短信等）
     */
    public void setSendNotifyStrategy(SendNotifyStrategy sendNotifyStrategy) {
        this.notification = new Notification();
        this.sendNotifyStrategy = sendNotifyStrategy;
    }

    /**
     * 发送通知给指定用户
     *
     * @param message 通知内容
     * @param userId 发送通知的用户ID
     */
    @Override
    public void sendMessage(String message, Long userId) throws Exception {
        notification.setContent(message);
        notification.setUserId(userId);
        sendNotifyStrategy.send(notification);
    }

    /**
     * 发送通知给多个用户
     *
     * @param message    通知内容
     * @param userIdList 用户ID列表
     */
    @Override
    public void setMessageToUserList(String message, List<Long> userIdList) throws Exception {
        for (Long userId : userIdList) {
            sendMessage(message, userId);
        }
    }

    /**
     * 设置通知的标题
     *
     * @param subject 通知的标题
     */
    @Override
    public void setSubject(String subject) {
        notification.setTitle(subject);
    }

    /**
     * 设置通知的优先级
     *
     * @param notificationLevel 通知的优先级（如 NORMAL, IMPORTANT, URGENT）
     */
    @Override
    public void setPriority(NotificationLevel notificationLevel) {
        notification.setLevel(notificationLevel);
    }

    /**
     * 设置通知的发送时间
     *
     * @param sendTime 通知的发送时间
     */
    @Override
    public void setSendTime(LocalDateTime sendTime) {
        notification.setSendTime(sendTime);
    }

    /**
     * 设置失败的重试策略
     *
     * @param maxRetries 最大重试次数
     */
    @Override
    public void setRetryPolicy(int maxRetries) {

    }

    /**
     * 设置消息模板
     *
     * @param template 消息模板
     */
    @Override
    public void setMessageTemplate(String template) {

    }
}
