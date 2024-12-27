package com.foodrecord.recommend.cache;

import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

@Component
public class RecommendCache {

    @Resource
    private RedisTemplate<String, Object> redisTemplate;
    
    private LoadingCache<String, Object> localCache;
    
    @PostConstruct
    public void init() {
        localCache = CacheBuilder.newBuilder()
                .maximumSize(10000)
                .expireAfterWrite(5, TimeUnit.MINUTES)
                .build(new CacheLoader<String, Object>() {
                    @Override
                    public Object load(String key) {
                        return redisTemplate.opsForValue().get(key);
                    }
                });
    }
    
    public void put(String key, Object value) {
        redisTemplate.opsForValue().set(key, value);
        localCache.put(key, value);
    }
    
    public Object get(String key) {
        try {
            return localCache.get(key);
        } catch (ExecutionException e) {
            return null;
        }
    }
    
    public void delete(String key) {
        redisTemplate.delete(key);
        localCache.invalidate(key);
    }
} 