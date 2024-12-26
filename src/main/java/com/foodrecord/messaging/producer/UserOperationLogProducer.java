package com.foodrecord.messaging.producer;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
public class UserOperationLogProducer {

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    public void sendLog(String logMessage) {
        kafkaTemplate.send("user-operation-logs", logMessage);
    }
}