package com.foodrecord.notification;

import com.foodrecord.model.entity.Notification;

import javax.mail.MessagingException;

public interface EmailNotificationService {
    void sendEmail(String to, String subject, String body) throws MessagingException;

    void sendWelcomeEmail(String to, String username) throws MessagingException;

    void send(Notification notification);

    void sendRegisterCodeEmail(String to, String username) throws MessagingException;

}
