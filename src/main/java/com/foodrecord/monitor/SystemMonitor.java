package com.foodrecord.monitor;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.OperatingSystemMXBean;
import java.util.HashMap;
import java.util.Map;

/**
 * 系统监控组件
 */
@Component
public class SystemMonitor implements HealthIndicator {
    private final JdbcTemplate jdbcTemplate;
    private final RedisTemplate<String, Object> redisTemplate;

    public SystemMonitor(JdbcTemplate jdbcTemplate, RedisTemplate<String, Object> redisTemplate) {
        this.jdbcTemplate = jdbcTemplate;
        this.redisTemplate = redisTemplate;
    }

    @Override
    public Health health() {
        Map<String, Object> details = new HashMap<>();
        
        // 检查数据库连接
        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            details.put("database", "UP");
        } catch (Exception e) {
            details.put("database", "DOWN");
            return Health.down().withDetails(details).build();
        }
        
        // 检查Redis连接
        try {
            redisTemplate.opsForValue().get("health_check");
            details.put("redis", "UP");
        } catch (Exception e) {
            details.put("redis", "DOWN");
            return Health.down().withDetails(details).build();
        }
        
        // 添加系统信息
        details.putAll(getSystemInfo());
        
        return Health.up().withDetails(details).build();
    }
    
    /**
     * 获取系统信息
     */
    private Map<String, Object> getSystemInfo() {
        Map<String, Object> info = new HashMap<>();
        
        // JVM内存信息
        MemoryMXBean memory = ManagementFactory.getMemoryMXBean();
        info.put("heap_used", memory.getHeapMemoryUsage().getUsed());
        info.put("heap_max", memory.getHeapMemoryUsage().getMax());
        info.put("non_heap_used", memory.getNonHeapMemoryUsage().getUsed());
        
        // CPU信息
        OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
        info.put("cpu_cores", os.getAvailableProcessors());
        info.put("system_load", os.getSystemLoadAverage());
        
        // 线程信息
        info.put("thread_count", ManagementFactory.getThreadMXBean().getThreadCount());
        
        return info;
    }
} 