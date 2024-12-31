package com.foodrecord.core.config;

import com.foodrecord.core.config.persistence.ConfigPersistence;
import org.springframework.stereotype.Component;
import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import java.util.Map;

@Component
public class DynamicConfigManager extends ConfigManager {
    private final ConfigPersistence configPersistence;
    
    public DynamicConfigManager(DynamicConfig dynamicConfig, ConfigPersistence configPersistence) {
        super(dynamicConfig);
        this.configPersistence = configPersistence;
    }
    
    @PostConstruct
    public void init() {
        Map<String, Object> savedConfig = configPersistence.load();
        savedConfig.forEach(this::updateConfig);
    }

    @PreDestroy
    public void destroy() {
        // 保存当前动态配置到持久化存储
        configPersistence.save(getDynamicConfig().getConfigMap());
    }

    @Override
    public void updateConfig(String key, Object value) {
        // 调用父类方法更新配置
        super.updateConfig(key, value);
        // 将更新后的配置保存到持久化存储
        configPersistence.save(getDynamicConfig().getConfigMap());
    }
} 