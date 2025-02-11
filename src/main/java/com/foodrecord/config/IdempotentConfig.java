package com.foodrecord.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "idempotent")
public class IdempotentConfig {
    private int expire = 3600; // 默认过期时间
    private int timeout = 1; // 默认防抖时间

    // Getters and Setters
    public int getExpire() {
        return expire;
    }

    public void setExpire(int expire) {
        this.expire = expire;
    }

    public int getTimeout() {
        return timeout;
    }

    public void setTimeout(int timeout) {
        this.timeout = timeout;
    }
} 