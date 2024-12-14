package com.foodrecord.common.utils;

import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
@Component
public class RedisPipelineUtils {

    private final RedisTemplate<String, Object> redisTemplate;

    public RedisPipelineUtils(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 批量设置缓存
     * @param dataMap 需要设置的键值对
     * @param timeout 过期时间（秒）
     */
    public void batchSet(Map<String, Object> dataMap, long timeout) {
        redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
            dataMap.forEach((key, value) -> {
                try {
                    // 强制转换为明确类型的序列化器
                    StringRedisSerializer keySerializer = (StringRedisSerializer) redisTemplate.getKeySerializer();
                    GenericJackson2JsonRedisSerializer valueSerializer = (GenericJackson2JsonRedisSerializer) redisTemplate.getValueSerializer();

                    byte[] rawKey = keySerializer.serialize(key);
                    byte[] rawValue = valueSerializer.serialize(value);
                    if (rawKey != null && rawValue != null) {
                        connection.setEx(rawKey, timeout, rawValue);
                    }
                } catch (Exception e) {
                    throw new IllegalArgumentException("Serialization error for key: " + key + ", value: " + value, e);
                }
            });
            return null;
        });
    }

    /**
     * 批量获取缓存
     * @param keys 要获取的键列表
     * @return 获取的值列表
     */
    public List<Object> batchGet(List<String> keys) {
        return redisTemplate.executePipelined((RedisCallback<Object>) connection -> {
            keys.forEach(key -> {
                try {
                    // 强制转换为明确类型的序列化器
                    StringRedisSerializer keySerializer = (StringRedisSerializer) redisTemplate.getKeySerializer();

                    byte[] rawKey = keySerializer.serialize(key);
                    if (rawKey != null) {
                        connection.get(rawKey);
                    }
                } catch (Exception e) {
                    throw new IllegalArgumentException("Serialization error for key: " + key, e);
                }
            });
            return null;
        }, redisTemplate.getValueSerializer());
    }
}

