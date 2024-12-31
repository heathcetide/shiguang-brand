package com.foodrecord.core.config;

import org.springframework.stereotype.Component;
import com.foodrecord.core.config.listener.ConfigChangeListener;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class ConfigManager {
    private final List<ConfigChangeListener> listeners = new CopyOnWriteArrayList<>();
    private final DynamicConfig dynamicConfig;

    public ConfigManager(DynamicConfig dynamicConfig) {
        this.dynamicConfig = dynamicConfig;
    }

    public void addListener(ConfigChangeListener listener) {
        listeners.add(listener);
    }

    public void removeListener(ConfigChangeListener listener) {
        listeners.remove(listener);
    }

    public void updateConfig(String key, Object value) {
        Object oldValue = dynamicConfig.getConfig(key);
        dynamicConfig.setConfig(key, value);
        notifyListeners(key, oldValue, value);
    }

    private void notifyListeners(String key, Object oldValue, Object newValue) {
        listeners.forEach(listener -> 
            listener.onConfigChanged(key, oldValue, newValue));
    }

    protected DynamicConfig getDynamicConfig() {
        return dynamicConfig;
    }
}