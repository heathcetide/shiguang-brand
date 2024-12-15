package com.foodrecord.notification;

import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import javax.mail.MessagingException;
import javax.mail.internet.MimeMessage;

@Service
public class EmailService {

    @Resource
    private JavaMailSender mailSender;

    public void sendEmail(String to, String subject, String content) {
        MimeMessage message = mailSender.createMimeMessage();
        try {
            MimeMessageHelper helper = new MimeMessageHelper(message, true);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(content, true); // 第二个参数表示是否为 HTML
            mailSender.send(message);
        } catch (MessagingException e) {
            throw new RuntimeException("发送邮件失败", e);
        }
    }
}
