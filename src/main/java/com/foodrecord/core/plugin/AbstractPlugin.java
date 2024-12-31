package com.foodrecord.core.plugin;

import com.foodrecord.controller.user.UserController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class AbstractPlugin implements PluginLifecycle {

    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    private PluginStatus status = PluginStatus.CREATED;

    public PluginStatus getStatus() {
        return status;
    }

    public void setStatus(PluginStatus status) {
        this.status = status;
    }

    @Override
    public void onLoad() {
        try {
            status = PluginStatus.LOADED;
            logger.info("Plugin {} loaded", this.getClass().getSimpleName());
        } catch (Exception e) {
            status = PluginStatus.ERROR;
            logger.error("Failed to load plugin {}", this.getClass().getSimpleName(), e);
        }
    }
    
    @Override
    public void onEnable() {
        try {
            status = PluginStatus.ENABLED;
            logger.info("Plugin {} enabled", this.getClass().getSimpleName());
        } catch (Exception e) {
            status = PluginStatus.ERROR;
            logger.error("Failed to enable plugin {}", this.getClass().getSimpleName(), e);
        }
    }
    
    @Override
    public void onDisable() {
        status = PluginStatus.DISABLED;
    }
    
    @Override
    public void onUnload() {
        status = PluginStatus.UNLOADED;
    }
} 