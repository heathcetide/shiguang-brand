package com.foodrecord.notification;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.model.entity.User;
import com.foodrecord.service.impl.UserServiceImpl;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import javax.annotation.Resource;
import javax.mail.internet.MimeMessage;

/**
 * 邮件通知发送器
 */
@Component
public class EmailNotificationSender implements NotificationSender {

    @Resource
    private JavaMailSender mailSender;
    private final TemplateEngine templateEngine;
    private final UserServiceImpl userService;

    public EmailNotificationSender(TemplateEngine templateEngine, UserServiceImpl userService) {
        this.templateEngine = templateEngine;
        this.userService = userService;
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
} 