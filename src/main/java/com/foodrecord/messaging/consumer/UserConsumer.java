//package com.foodrecord.messaging.consumer;
//
//import com.foodrecord.model.entity.user.User;
//import com.foodrecord.notification.impl.EmailNotificationSender;
//import com.foodrecord.service.UserService;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.beans.factory.annotation.Qualifier;
//import org.springframework.kafka.annotation.KafkaListener;
//import org.springframework.stereotype.Service;
//import javax.annotation.Resource;
//import javax.mail.MessagingException;
//
//@Service
//@KafkaListener(topics = "user-registration", groupId = "notification-group")
//public class UserConsumer {
//
//    @Autowired
//    @Qualifier("foodUserService")
//    private UserService userService;
//
//    @Autowired
//    private EmailNotificationSender emailNotificationSender;
//
//    public void listen(String userId) throws MessagingException {
//        // 获取用户详细信息
//        User user = userService.getUserById(Long.parseLong(userId));
//        // 发送欢迎邮件
//        emailNotificationSender.sendWelcomeEmail(user.getEmail(), user.getUsername());
//    }
//}
