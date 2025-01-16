package com.foodrecord.common.utils;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.concurrent.TimeUnit;

@Component
public class RedisUtils {
    private final RedisTemplate<String, Object> redisTemplate;

    public RedisUtils(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void set(String key, String value, long timeout, TimeUnit unit) {
        redisTemplate.opsForValue().set(key, value, timeout, unit);
    }

    public boolean exists(String key) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(key));
    }

    /**
     * 设置缓存
     */
    public void set(String key, Object value, long time) {
        redisTemplate.opsForValue().set(key, value, time, TimeUnit.SECONDS);
    }

    /**
     * 设置缓存
     */
    public void set(String key, Object value) {
        redisTemplate.opsForValue().set(key, value);
    }

    /**
     * 获取缓存
     */
    public Object get(String key) {
        return redisTemplate.opsForValue().get(key);
    }

    /**
     * 获取值
     *
     * @param key 键
     * @param clazz 返回的类型
     * @return 值
     */
    public <T> T get(String key, Class<T> clazz) {
        Object value = redisTemplate.opsForValue().get(key);
        if (value == null) {
            return null;
        }

        if (clazz.isInstance(value)) {
            return clazz.cast(value);
        }

        if (value instanceof String && clazz == String.class) {
            return clazz.cast(value);
        }

        throw new IllegalArgumentException("无法将 Redis 值转换为类型: " + clazz.getName());
    }
    /**
     * 删除缓存
     */
    public Boolean delete(String key) {
        return redisTemplate.delete(key);
    }

    /**
     * lazy-free 惰性释放
     */
    public Boolean delLazyFree(String key){
        return redisTemplate.unlink(key);
    }

    /**
     * 判断key是否存在
     */
    public Boolean hasKey(String key) {
        return redisTemplate.hasKey(key);
    }

    /**
     * 设置过期时间
     */
    public Boolean expire(String key, long time) {
        return redisTemplate.expire(key, time, TimeUnit.SECONDS);
    }

    /**
     * 获取过期时间
     */
    public Long getExpire(String key) {
        return redisTemplate.getExpire(key, TimeUnit.SECONDS);
    }

    /**
     * 自增操作
     * @param key 键
     * @param delta 增量（通常为1，负数表示减少）
     * @return 自增后的值
     */
    public Long increment(String key, long delta) {
        return redisTemplate.opsForValue().increment(key, delta);
    }

    /**
     * 设置值，如果 key 不存在则设置成功（分布式锁的典型用法）
     * @param key 键
     * @param value 值
     * @param time 过期时间（秒）
     * @return 是否设置成功
     */
    public Boolean setIfAbsent(String key, String value, long time) {
        Boolean result = redisTemplate.opsForValue().setIfAbsent(key, value, time, TimeUnit.SECONDS);
        return result != null && result;
    }

    /**
     * 获取匹配的所有键
     * @param pattern 匹配模式（如 "prefix:*"）
     * @return 匹配的键集合
     */
    public Set<String> keys(String pattern) {
        return redisTemplate.keys(pattern);
    }
} 