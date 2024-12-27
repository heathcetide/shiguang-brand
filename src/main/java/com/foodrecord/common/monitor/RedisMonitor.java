package com.foodrecord.common.monitor;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.annotation.Resource;
import java.util.Properties;

@Component
public class RedisMonitor {

    @Resource
    private RedisTemplate<String, Object> redisTemplate;
    
    @Scheduled(fixedRate = 300000) // 每5分钟执行一次
    public void monitorRedisStatus() {
        Properties info = redisTemplate.getConnectionFactory()
            .getConnection()
            .info();

        System.out.println("Redis使用情况:");
        System.out.println("内存使用: {}"+ info.getProperty("used_memory_human"));
        System.out.println("连接数: {}"+ info.getProperty("connected_clients"));
        System.out.println("命中率: {}"+ info.getProperty("keyspace_hits"));
    }
} 