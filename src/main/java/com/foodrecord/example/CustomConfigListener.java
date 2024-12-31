package com.foodrecord.example;

import com.foodrecord.controller.user.UserController;
import com.foodrecord.core.config.listener.ConfigChangeListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;


@Component
public class CustomConfigListener implements ConfigChangeListener {

    private static final Logger logger = LoggerFactory.getLogger(UserController.class);

    @Override
    public void onConfigChanged(String key, Object oldValue, Object newValue) {
        logger.info("Config changed - key: {}, old: {}, new: {}", key, oldValue, newValue);
    }
} 