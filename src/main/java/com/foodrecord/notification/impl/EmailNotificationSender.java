package com.foodrecord.notification.impl;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.notification.EmailNotificationService;
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
public class EmailNotificationSender implements EmailNotificationService {

    @Resource
    private JavaMailSender mailSender;

    @Autowired
    @Qualifier("foodUserService")
    private UserService userService;


    @Autowired
    private SpringTemplateEngine templateEngine;

    @Override
    public void sendEmail(String to, String subject, String body) throws MessagingException {
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
    public void sendWelcomeEmail(String to, String username) throws MessagingException {
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
    public void send(Notification notification) {
        try {
            // 获取用户邮箱
            User user = userService.getById(notification.getUserId());
            if (user == null || user.getEmail() == null) {
                return;
            }

            // 准备邮件内容
            Context context = new Context();
            context.setVariable("notification", notification);
            String emailContent = templateEngine.process("notification", context);

            // 发送邮件
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setTo(user.getEmail());
            helper.setSubject(notification.getTitle());
            helper.setText(emailContent, true);

            mailSender.send(message);
        } catch (Exception e) {
            throw new RuntimeException("发送邮件通知失败", e);
        }
    }

    @Override
    public void sendRegisterCodeEmail(String to, String code) throws MessagingException {
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
