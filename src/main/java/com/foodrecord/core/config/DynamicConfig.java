package com.foodrecord.core.config;

import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class DynamicConfig {
    private final ConcurrentHashMap<String, Object> configMap = new ConcurrentHashMap<>();

    public void setConfig(String key, Object value) {
        configMap.put(key, value);
    }

    public Object getConfig(String key) {
        return configMap.get(key);
    }

    public Object getConfig(String key, Object defaultValue) {
        return configMap.getOrDefault(key, defaultValue);
    }

    public Map<String, Object> getConfigMap() {
        return configMap;
    }
} 