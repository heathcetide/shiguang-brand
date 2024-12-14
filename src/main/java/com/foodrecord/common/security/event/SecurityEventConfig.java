package com.foodrecord.common.security.event;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.AsyncConfigurer;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * 安全事件配置类
 * 配置异步事件处理的线程池
 * 
 * @author yourname
 * @since 1.0.0
 */
@Configuration
@EnableAsync
public class SecurityEventConfig implements AsyncConfigurer {
    
    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(25);
        executor.setThreadNamePrefix("SecurityEvent-");
        executor.initialize();
        return executor;
    }
} 