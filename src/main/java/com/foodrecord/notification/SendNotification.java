package com.foodrecord.notification;

import com.foodrecord.model.enums.NotificationLevel;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 消息推送接口
 */
public interface SendNotification {

    /**
     * 设置发送策略
     * @param sendNotifyStrategy 发送策略
     */
    void setSendNotifyStrategy(SendNotifyStrategy sendNotifyStrategy);

    /**
     * 发送消息到接收者
     *
     * @param message 消息内容
     * @param userId 用户Id
     */
    void sendMessage(String message, Long userId) throws Exception;

    /**
     * 发送消息给接收者列表
     * @param message 消息内容
     * @param userIdList 用户id列表
     */
    void setMessageToUserList(String message, List<Long> userIdList) throws Exception;

    /**
     * 设置消息主题（如电子邮件的主题）
     *
     * @param subject 主题
     */
    void setSubject(String subject) ;

    /**
     * 设置消息优先级（如高、低、正常）
     *
     * @param notificationLevel 优先级
     */
    void setPriority(NotificationLevel notificationLevel);

    /**
     * 设置消息发送时间（定时发送）
     *
     * @param sendTime 发送时间
     */
    void setSendTime(LocalDateTime sendTime);

    /**
     * 设置失败重试机制，指定最大重试次数
     *
     * @param maxRetries 最大重试次数
     */
    void setRetryPolicy(int maxRetries);

    /**
     * 格式化消息内容，支持 HTML 或模板格式
     *
     * @param template 模板
     */
    void setMessageTemplate(String template);
}
