//package com.foodrecord.messaging.producer;
//
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.kafka.core.KafkaTemplate;
//import org.springframework.stereotype.Service;
//
//import java.time.LocalDateTime;
//
//@Service
//public class UserProducer {
//
//    @Autowired
//    private KafkaTemplate<String, String> kafkaTemplate;
//
//    public void sendUserRegistrationEvent(String userId) {
//        kafkaTemplate.send("user-registration", userId);
//    }
//
//    public void logActivity(String userId, String activityType) {
//        String message = String.format("{\"userId\": \"%s\", \"activity\": \"%s\", \"timestamp\": \"%s\"}",
//                userId, activityType, LocalDateTime.now());
//        kafkaTemplate.send("user-activity", message);
//    }
//}
