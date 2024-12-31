package com.foodrecord.example;

import com.foodrecord.core.module.AbstractModule;
import com.foodrecord.core.module.annotation.Module;
import org.springframework.stereotype.Component;

@Component
@Module(name = "customModule", dependencies = {"baseModule"})
public class CustomModule extends AbstractModule {
    @Override
    public void onInit() {
        super.onInit();
        // 自定义初始化逻辑
    }

    @Override
    public void onStart() {
        super.onStart();
        // 自定义启动逻辑
    }
} 