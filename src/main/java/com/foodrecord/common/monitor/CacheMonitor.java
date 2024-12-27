package com.foodrecord.common.monitor;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

@Component
public class CacheMonitor {

    private final RedisTemplate<String, Object> redisTemplate;
    private final MeterRegistry meterRegistry;
    
    private Counter cacheHits;
    private Counter cacheMisses;
    private Timer cacheGetTimer;

    public CacheMonitor(RedisTemplate<String, Object> redisTemplate, MeterRegistry meterRegistry) {
        this.redisTemplate = redisTemplate;
        this.meterRegistry = meterRegistry;
    }

    @PostConstruct
    public void init() {
        cacheHits = Counter.builder("cache.hits")
            .description("缓存命中次数")
            .register(meterRegistry);
            
        cacheMisses = Counter.builder("cache.misses")
            .description("缓存未命中次数")
            .register(meterRegistry);
            
        cacheGetTimer = Timer.builder("cache.get.time")
            .description("缓存获取耗时")
            .register(meterRegistry);
    }
    
    /**
     * 监控缓存状态
     */
    @Scheduled(fixedRate = 60000)
    public void monitorCacheStatus() {
        Properties info = redisTemplate.getConnectionFactory()
                .getConnection()
                .info();

        // Redis 使用的内存（转为数值类型）
        Gauge.builder("redis.memory.used", () -> {
            String usedMemory = info.getProperty("used_memory");
            return usedMemory != null ? Double.valueOf(usedMemory) : 0;
        }).register(meterRegistry);

        // Redis 连接的客户端数（转为数值类型）
        Gauge.builder("redis.clients.connected", () -> {
            String connectedClients = info.getProperty("connected_clients");
            return connectedClients != null ? Integer.valueOf(connectedClients) : 0;
        }).register(meterRegistry);

        // 记录命中率
        double hitRate = calculateHitRate(cacheHits.count(), cacheMisses.count());
        System.out.println("缓存命中率: {}%"+ hitRate);
    }
    
    /**
     * 记录缓存操作
     */
    public void recordCacheOperation(boolean isHit, long responseTime) {
        if (isHit) {
            cacheHits.increment();
        } else {
            cacheMisses.increment();
        }
        cacheGetTimer.record(responseTime, TimeUnit.MILLISECONDS);
    }

    /**
     *
     * @param hits
     * @param misses
     * @return
     */
    private double calculateHitRate(double hits, double misses) {
        double total = hits + misses;
        return total == 0 ? 0 : (hits / total) * 100;
    }

} 