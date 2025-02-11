package com.foodrecord.notification.impl;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.model.entity.User;
import com.foodrecord.model.enums.NotificationLevel;
import com.foodrecord.notification.SendNotifyStrategy;
import com.foodrecord.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.thymeleaf.context.Context;
import org.thymeleaf.spring5.SpringTemplateEngine;

import javax.annotation.Resource;
import javax.mail.MessagingException;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

@Service
@Qualifier("emailStrategy")
public class EmailSendNotification implements SendNotifyStrategy {

    @Resource
    private JavaMailSender mailSender;

    @Autowired
    @Qualifier("foodUserService")
    private UserService userService;


    @Autowired
    private SpringTemplateEngine templateEngine;

    @Override
    public void send(Notification notification) {
        try {
            // 获取用户邮箱
            User user = userService.getById(notification.getUserId());
            if (user == null || user.getEmail() == null) {
                return;
            }

            // 根据通知级别选择模板和内容
            String templateName = getTemplateNameByLevel(notification.getLevel());
            Context context = new Context();
            context.setVariable("notification", notification); // 设置通知对象的数据
            context.setVariable("user", user); // 如果需要使用用户信息，可以在模板中使用

            // 渲染模板
            String emailContent = templateEngine.process(templateName, context);

            // 发送邮件
            sendMessage(user.getEmail(), notification.getTitle(), emailContent);
        } catch (Exception e) {
            throw new RuntimeException("发送邮件通知失败", e);
        }
    }

    private String getTemplateNameByLevel(NotificationLevel level) {
        // 根据通知级别返回不同的模板
        switch (level) {
            case WELCOME:
                return "welcome-email";
            case Verification:
                return "send-email-register";
            case IMPORTANT:
                return "important-notification";
            case URGENT:
                return "urgent-notification";
            case NORMAL:
                return "normal-notification";
            default:
                return "notification";
        }
    }

    @Override
    public void sendMessage(String to, String subject, String body) throws MessagingException {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
        message.setFrom("heath-cetide@zohomail.com");
        // 设置带有显示名称的 From 地址
        String officialFrom = "食光烙记官方 <heath-cetide@zohomail.com>";
        helper.setFrom(new InternetAddress(officialFrom));
        helper.setTo(to);
        helper.setSubject(subject);
        helper.setText(body, true);
        mailSender.send(message);
    }

    @Override
    public void sendWelcomeMessage(String to, String username) throws MessagingException {
        // 创建邮件内容
        Context context = new Context();
        context.setVariable("username", username); // 设置动态变量
        // 渲染模板
        String body = templateEngine.process("welcome-email", context);
        // 创建邮件
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
        message.setFrom("heath-cetide@zohomail.com");
        // 设置带有显示名称的 From 地址
        String officialFrom = "食光烙记官方 <heath-cetide@zohomail.com>";
        helper.setFrom(new InternetAddress(officialFrom));
        helper.setTo(to);
        helper.setSubject("欢迎加入食光烙记！");
        helper.setText(body, true);
        // 发送邮件
        mailSender.send(message);
    }

    @Override
    public void sendRegisterCodeMessage(String to, String code) throws MessagingException {
        // 创建邮件内容
        Context context = new Context();
        context.setVariable("verificationCode", code); // 设置动态变量
        // 渲染模板
        String body = templateEngine.process("send-email-register", context);
        // 创建邮件
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
        message.setFrom("heath-cetide@zohomail.com");
        // 设置带有显示名称的 From 地址
        String officialFrom = "食光烙记官方 <heath-cetide@zohomail.com>";
        helper.setFrom(new InternetAddress(officialFrom));
        helper.setTo(to);
        helper.setSubject("欢迎加入食光烙记！");
        helper.setText(body, true);
        // 发送邮件
        mailSender.send(message);
    }
}
