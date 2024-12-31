package com.foodrecord.core.config.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.controller.user.UserController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import java.io.File;
import java.util.HashMap;
import java.util.Map;

@Component
public class FileConfigPersistence implements ConfigPersistence {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String configFile = "config/application-dynamic.json";
    private static final Logger logger = LoggerFactory.getLogger(UserController.class);

    @Override
    public void save(Map<String, Object> config) {
        try {
            File file = new File(configFile);
            file.getParentFile().mkdirs();
            objectMapper.writeValue(file, config);
        } catch (Exception e) {
            logger.error("Failed to save config", e);
        }
    }
    
    @Override
    public Map<String, Object> load() {
        try {
            File file = new File(configFile);
            if (file.exists()) {
                return objectMapper.readValue(file, Map.class);
            }
        } catch (Exception e) {
            logger.error("Failed to load config", e);
        }
        return new HashMap<>();
    }
} 