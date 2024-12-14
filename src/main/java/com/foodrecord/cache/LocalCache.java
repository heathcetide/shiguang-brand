package com.foodrecord.cache;

import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
public class LocalCache {

    private final Cache<String, Object> cache;

    public LocalCache() {
        this.cache = CacheBuilder.newBuilder()
                .expireAfterWrite(1, TimeUnit.HOURS) // 设置缓存过期时间
                .maximumSize(1000)                  // 设置最大缓存数量
                .build();
    }

    /**
     * 从本地缓存获取数据
     */
    @SuppressWarnings("unchecked")
    public <T> T get(String key, Class<T> type) {
        Object value = cache.getIfPresent(key);
        if (value != null && type.isInstance(value)) {
            return (T) value;
        }
        return null;
    }

    /**
     * 向本地缓存放入数据
     */
    public void put(String key, Object value) {
        cache.put(key, value);
    }
}
