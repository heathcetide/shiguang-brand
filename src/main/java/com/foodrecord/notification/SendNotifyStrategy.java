package com.foodrecord.notification;

import com.foodrecord.model.entity.Notification;

/**
 * 发送通知的策略接口
 * 该接口定义了通知发送策略，包括发送通知、发送欢迎邮件、发送验证码邮件等方法。
 */
public interface SendNotifyStrategy {

    /**
     * 发送通知
     *
     * @param notification 通知对象，包含通知的所有信息
     */
    void send(Notification notification) throws Exception;

    /**
     * 发送邮件通知
     *
     * @param to      收件人邮箱
     * @param subject 邮件主题
     * @param body    邮件内容
     * @throws Exception 发送邮件时可能抛出的异常
     */
    void sendMessage(String to, String subject, String body) throws Exception;

    /**
     * 发送欢迎邮件
     *
     * @param to      收件人邮箱
     * @param username 用户名，用于个性化邮件
     * @throws Exception 发送邮件时可能抛出的异常
     */
    void sendWelcomeMessage(String to, String username) throws Exception;

    /**
     * 发送注册验证码邮件
     *
     * @param to      收件人邮箱
     * @param username    注册验证码
     * @throws Exception 发送邮件时可能抛出的异常
     */
    void sendRegisterCodeMessage(String to, String username) throws Exception;

}
