package com.foodrecord.notification.impl;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.notification.SendNotifyStrategy;
import com.foodrecord.service.WeChatService;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
@Qualifier("weChatStrategy")
public class WeChatNotification implements SendNotifyStrategy {

    private final WeChatService weChatService;  // 假设这是一个封装了微信接口的服务

    // 构造方法注入
    public WeChatNotification(WeChatService weChatService) {
        this.weChatService = weChatService;
    }

    @Override
    public void send(Notification notification) throws Exception {
        // 发送普通通知
        String to = notification.getUserId().toString(); // 假设通过 UserId 获取目标用户
        String message = notification.getContent();     // 获取通知内容

        // 调用微信的发送消息服务
        weChatService.sendMessageToUser(to, message);
    }

    @Override
    public void sendMessage(String to, String subject, String body) throws Exception {
        // 发送包含标题和正文的消息
        String message = "Subject: " + subject + "\n" + "Body: " + body;

        // 调用微信的发送消息服务
        weChatService.sendMessageToUser(to, message);
    }

    @Override
    public void sendWelcomeMessage(String to, String username) throws Exception {
        // 发送欢迎消息
        String message = "Welcome " + username + " to our service! We are excited to have you on board.";

        // 调用微信的发送消息服务
        weChatService.sendMessageToUser(to, message);
    }

    @Override
    public void sendRegisterCodeMessage(String to, String username) throws Exception {
        // 生成注册验证码（假设是一个随机的6位数字）
        String registerCode = generateRegisterCode();

        String message = "Hello " + username + ", your registration code is: " + registerCode;

        // 调用微信的发送消息服务
        weChatService.sendMessageToUser(to, message);
    }

    // 生成一个 6 位随机验证码
    private String generateRegisterCode() {
        int code = (int) (Math.random() * 900000) + 100000;
        return String.valueOf(code);
    }
}
