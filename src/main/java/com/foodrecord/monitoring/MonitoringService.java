package com.foodrecord.monitoring;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class MonitoringService {
    private static final Logger logger = LoggerFactory.getLogger(MonitoringService.class);

    public void logRequest(String method, String uri, String params, long duration) {
        logger.info("请求: {} {} 参数: {} 耗时: {}ms", method, uri, params, duration);
    }

    public void alert(String message) {
        // 发送告警逻辑
        logger.error("告警: {}", message);
    }
} 