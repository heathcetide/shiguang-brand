package com.foodrecord.notification.impl;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.notification.NotificationService;
import com.foodrecord.notification.SendNotifyStrategy;
import com.foodrecord.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
@Qualifier("inAppStrategy")
public class InAppNotification implements SendNotifyStrategy {

    @Autowired
    private UserService userService;

    @Autowired
    private NotificationService notificationService;

    /**
     * 发送站内通知
     *
     * @param notification 通知对象
     */
    @Override
    public void send(Notification notification) throws Exception {
        // 获取用户信息
        User user = userService.getById(notification.getUserId());
        if (user == null) {
            throw new Exception("用户不存在");
        }

        // 设置通知状态为未读
        notification.setRead(false);

        // 存储通知到数据库
        saveInAppNotification(notification);
    }

    /**
     * 发送站内消息
     *
     * @param to      收件人手机号
     * @param subject 短信内容
     */
    @Override
    public void sendMessage(String to, String subject, String body) throws Exception {
        // 站内消息不发送邮件，抛出异常
        throw new UnsupportedOperationException("站内通知不支持通过邮件发送");
    }

    @Override
    public void sendWelcomeMessage(String to, String username) throws Exception {
        // 不需要处理，欢迎信息会直接保存为站内通知
        throw new UnsupportedOperationException("不支持通过邮件发送欢迎消息");
    }

    @Override
    public void sendRegisterCodeMessage(String to, String username) throws Exception {
        // 不需要处理，验证码也会直接保存为站内通知
        throw new UnsupportedOperationException("不支持通过邮件发送注册验证码");
    }

    /**
     * 保存站内通知到数据库
     *
     * @param notification 通知对象
     */
    private void saveInAppNotification(Notification notification) {
        // 调用 NotificationService 保存通知到数据库
        notificationService.sendNotification(notification);
        System.out.println("站内通知已保存到数据库: " + notification);
    }

}
