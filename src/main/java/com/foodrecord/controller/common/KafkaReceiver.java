package com.foodrecord.controller.common;

import java.util.Optional;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class KafkaReceiver {

    // #1. 监听主题为topic的消息
    @KafkaListener(topics = {"topic"})
    public void listen(ConsumerRecord<?, ?> record) {
        // #2. 如果消息存在
        Optional<?> kafkaMessage = Optional.ofNullable(record.value());
        if (kafkaMessage.isPresent()) {
            // #3. 获取消息
            Object message = kafkaMessage.get();
            System.out.println("message =" + message);
        }

    }
}