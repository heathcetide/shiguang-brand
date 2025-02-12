package com.foodrecord.common.cache;

public interface CacheStrategy {
    void put(String key, Object value, long timeout);
    Object get(String key);
    boolean exists(String key);
} 