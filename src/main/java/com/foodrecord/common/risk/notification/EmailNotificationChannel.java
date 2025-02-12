//package com.foodrecord.common.risk.notification;
//
//import org.springframework.mail.SimpleMailMessage;
//import org.springframework.mail.javamail.JavaMailSender;
//import org.springframework.stereotype.Component;
//
//import javax.annotation.Resource;
//
//@Component
//public class EmailNotificationChannel implements NotificationChannel {
//
//    @Resource
//    private JavaMailSender mailSender;
//
//    private final String fromAddress = "risk-alert@example.com";
//    private final String[] toAddresses = {"admin@example.com"};
//
//    @Override
//    public void send(String content) {
//        SimpleMailMessage message = new SimpleMailMessage();
//        message.setFrom(fromAddress);
//        message.setTo(toAddresses);
//        message.setSubject("Risk Alert");
//        message.setText(content);
//        mailSender.send(message);
//    }
//
//    @Override
//    public boolean isAvailable() {
//        return true;
//    }
//
//    @Override
//    public String getChannelType() {
//        return "email";
//    }
//}