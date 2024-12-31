package com.foodrecord.example;

import com.foodrecord.core.plugin.AbstractPlugin;
import com.foodrecord.core.plugin.annotation.Plugin;
import com.foodrecord.core.flow.FlowEngine;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
@Plugin(name = "customFlowPlugin", version = "1.0", description = "自定义流程插件")
public class CustomFlowPlugin extends AbstractPlugin {
    @Autowired
    private FlowEngine flowEngine;
    
    @Override
    public void onEnable() {
        super.onEnable();
        // 注册自定义流程
        registerCustomFlows();
    }
    
    private void registerCustomFlows() {
        // 实现自定义流程注册
    }
} 