package com.foodrecord.core.plugin;

public interface PluginLifecycle {
    void onLoad();
    void onEnable();
    void onDisable();
    void onUnload();
} 