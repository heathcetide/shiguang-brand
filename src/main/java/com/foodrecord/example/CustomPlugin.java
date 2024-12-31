package com.foodrecord.example;

import com.foodrecord.core.plugin.annotation.Plugin;
import org.springframework.stereotype.Component;

@Component
@Plugin(name = "customPlugin", version = "1.0", description = "示例插件")
public class CustomPlugin {
    public void doSomething() {
        // 插件功能实现
    }
} 