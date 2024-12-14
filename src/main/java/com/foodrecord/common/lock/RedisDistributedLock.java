package com.foodrecord.common.lock;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.concurrent.TimeUnit;

@Component
public class RedisDistributedLock {

    private final RedisTemplate<String, Object> redisTemplate;
    private static final String LOCK_PREFIX = "lock:";
    private static final long DEFAULT_EXPIRE = 30000L; // 30秒

    public RedisDistributedLock(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 获取分布式锁
     */
    public boolean lock(String key, String value, long expireTime) {
        String lockKey = LOCK_PREFIX + key;
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, value, expireTime, TimeUnit.MILLISECONDS);
        return Boolean.TRUE.equals(success);
    }
    
    /**
     * 释放分布式锁
     */
    public boolean unlock(String key, String value) {
        String lockKey = LOCK_PREFIX + key;
        String script = "if redis.call('get', KEYS[1]) == ARGV[1] then " +
                       "return redis.call('del', KEYS[1]) else return 0 end";
        DefaultRedisScript<Long> redisScript = new DefaultRedisScript<>(script, Long.class);
        Long result = redisTemplate.execute(redisScript, Collections.singletonList(lockKey), value);
        return Long.valueOf(1L).equals(result);
    }
} 