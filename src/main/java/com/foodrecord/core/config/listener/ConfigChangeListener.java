package com.foodrecord.core.config.listener;

public interface ConfigChangeListener {
    void onConfigChanged(String key, Object oldValue, Object newValue);
} 