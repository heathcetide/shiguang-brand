package com.foodrecord.cache;

import com.foodrecord.common.utils.RedisUtils;

import java.util.concurrent.TimeUnit;

public class RedisCacheStrategy implements CacheStrategy {
    private final RedisUtils redisUtils;

    public RedisCacheStrategy(RedisUtils redisUtils) {
        this.redisUtils = redisUtils;
    }

    @Override
    public void put(String key, Object value, long timeout) {
        redisUtils.set(key, value, timeout, TimeUnit.SECONDS);
    }

    @Override
    public Object get(String key) {
        return redisUtils.get(key);
    }

    @Override
    public boolean exists(String key) {
        return redisUtils.exists(key);
    }
} 