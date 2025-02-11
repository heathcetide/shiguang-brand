package com.foodrecord.common.monitor;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.google.common.util.concurrent.RateLimiter;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.annotation.Resource;
import java.time.LocalTime;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

@Component
public class RedisMonitor {

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final Logger logger = LoggerFactory.getLogger(RedisMonitor.class);

    public static Double currentInterval = 1000.0;

    // 定义一些常见的阈值
    private static final double HIGH_MEMORY_USAGE_THRESHOLD = 80.0; // 内存使用超过80%时增加限流力度
    private static final int HIGH_CONNECTIONS_THRESHOLD = 1000; // 连接数超过1000时增加限流力度
    private static final double LOW_HIT_RATE_THRESHOLD = 50.0; // 命中率低于50%时减少限流力度

    private static final LocalTime PEAK_START = LocalTime.of(18, 0);
    private static final LocalTime PEAK_END = LocalTime.of(22, 0);

    @Scheduled(fixedRate = 300000) // 每5分钟执行一次
    public void monitorRedisStatus() {
        Properties info = redisTemplate.getConnectionFactory()
                .getConnection()
                .info();

        // 获取 Redis 使用情况
        double memoryUsage = parseMemoryUsage(info.getProperty("used_memory_human"));
        int connections = Integer.parseInt(info.getProperty("connected_clients"));
        double hitRate = parseHitRate(info.getProperty("keyspace_hits"));

        // 计算限流力度
        adjustRateLimiter(memoryUsage, connections, hitRate);

        logger.info("Redis状态监控：内存使用: {}, 连接数: {}, 命中率: {}",
                memoryUsage, connections, hitRate);
        logger.info("动态调整后的限流力度: {}", currentInterval);

    }

    private void adjustRateLimiter(double memoryUsage, int connections, double hitRate) {
        double weight = 1000.0; // 初始限流力度

        // 根据内存使用量调整限流力度
        weight = adjustForMemoryUsage(weight, memoryUsage);

        // 根据连接数调整限流力度
        weight = adjustForConnections(weight, connections);

        // 根据命中率调整限流力度
        weight = adjustForHitRate(weight, hitRate);

        // 根据是否处于高峰期调整限流力度
        weight = adjustForPeakTime(weight);

        // 更新限流力度
        currentInterval = weight;

        logger.info("RateLimiter更新为: {}", currentInterval);
    }

    // 根据内存使用情况调整限流力度
    private double adjustForMemoryUsage(double weight, double memoryUsage) {
        if (memoryUsage > HIGH_MEMORY_USAGE_THRESHOLD) {
            weight *= 1.5;  // 内存使用过高时，增加限流力度
        } else if (memoryUsage > 70.0) {
            weight *= 1.2;  // 内存使用较高时，适度增加限流力度
        }
        return weight;
    }

    // 根据连接数调整限流力度
    private double adjustForConnections(double weight, int connections) {
        if (connections > HIGH_CONNECTIONS_THRESHOLD) {
            weight *= 1.3;  // 连接数过多时，增加限流力度
        } else if (connections > 800) {
            weight *= 1.2;  // 连接数较多时，适度增加限流力度
        }
        return weight;
    }

    // 根据命中率调整限流力度
    private double adjustForHitRate(double weight, double hitRate) {
        if (hitRate < LOW_HIT_RATE_THRESHOLD) {
            weight *= 1.5;  // 命中率低时，减少流量，增加限流力度
        } else if (hitRate < 70.0) {
            weight *= 1.2;  // 命中率较低时，适度增加限流力度
        }
        return weight;
    }

    // 根据当前时间是否是高峰期来调整限流力度
    private double adjustForPeakTime(double weight) {
        LocalTime now = LocalTime.now();
        if (now.isAfter(PEAK_START) && now.isBefore(PEAK_END)) {
            weight *= 0.8;  // 高峰期时放松限流力度
        } else {
            weight *= 1.5;  // 非高峰期时增加限流力度
        }
        return weight;
    }

    // 解析内存使用量
    private double parseMemoryUsage(String memoryUsage) {
        try {
            if (memoryUsage != null && memoryUsage.contains("mb")) {
                return Double.parseDouble(memoryUsage.replace("mb", "").trim());
            }
        } catch (NumberFormatException e) {
            logger.error("解析内存使用量失败", e);
        }
        return 0.0;
    }

    // 解析命中率
    private double parseHitRate(String hitRate) {
        try {
            return Double.parseDouble(hitRate);
        } catch (NumberFormatException e) {
            logger.error("解析命中率失败", e);
        }
        return 0.0;
    }
}