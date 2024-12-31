package com.foodrecord.core.config.persistence;

import java.util.Map;

public interface ConfigPersistence {
    void save(Map<String, Object> config);
    Map<String, Object> load();
} 