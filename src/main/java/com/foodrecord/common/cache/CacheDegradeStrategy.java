package com.foodrecord.common.cache;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

@Component
public class CacheDegradeStrategy {

    private final RedisTemplate<String, Object> redisTemplate;
    private final LocalCache localCache;

    public CacheDegradeStrategy(RedisTemplate<String, Object> redisTemplate, LocalCache localCache) {
        this.redisTemplate = redisTemplate;
        this.localCache = localCache;
    }

    /**
     * 多级缓存获取
     */
    public <T> T getWithFallback(String key, Class<T> type, Supplier<T> dbFallback) {
        try {
            // 1. 尝试从Redis获取
            Object value = redisTemplate.opsForValue().get(key);
            if (value != null) {
                return type.cast(value);
            }
            
            // 2. 尝试从本地缓存获取
            T localValue = localCache.get(key, type);
            if (localValue != null) {
                return localValue;
            }
            
            // 3. 从数据库获取
            T dbValue = dbFallback.get();
            if (dbValue != null) {
                // 回写缓存
                redisTemplate.opsForValue().set(key, dbValue, 1, TimeUnit.HOURS);
                localCache.put(key, dbValue);
            }
            return dbValue;
            
        } catch (Exception e) {
            System.out.println("缓存访问异常,降级处理"+ e);
            return localCache.get(key, type);
        }
    }
} 