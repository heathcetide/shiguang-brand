package com.foodrecord.core.plugin;

import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class PluginManager {
    private final Map<String, Object> plugins = new ConcurrentHashMap<>();

    public void registerPlugin(String name, Object plugin) {
        plugins.put(name, plugin);
    }

    public Object getPlugin(String name) {
        return plugins.get(name);
    }

    public void removePlugin(String name) {
        plugins.remove(name);
    }
} 