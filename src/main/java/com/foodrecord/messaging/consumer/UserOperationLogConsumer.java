package com.foodrecord.messaging.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.model.entity.user.UserOperationLog;
import com.foodrecord.service.UserOperationLogService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class UserOperationLogConsumer {

    @Autowired
    private UserOperationLogService logService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(topics = "user-operation-logs", groupId = "log-group")
    public void consumeLog(String message) {
        try {
            // 使用 Jackson 解析 JSON 消息
            UserOperationLog log = objectMapper.readValue(message, UserOperationLog.class);
            logService.addOperationLog(log);
        } catch (Exception e) {
            // 捕获解析异常
            e.printStackTrace();
            // 可以添加日志记录或异常处理逻辑
        }
    }
}
