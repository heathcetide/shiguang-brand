package com.foodrecord.core.plugin;

import org.springframework.stereotype.Component;
import com.foodrecord.core.plugin.annotation.Plugin;
import org.springframework.context.ApplicationContext;
import org.springframework.beans.factory.annotation.Autowired;

import javax.annotation.PostConstruct;


@Component
public class PluginLoader {
    @Autowired
    private ApplicationContext applicationContext;
    
    @Autowired
    private PluginManager pluginManager;
    
    @PostConstruct
    public void loadPlugins() {
        // 扫描所有带有@Plugin注解的类
        applicationContext.getBeansWithAnnotation(Plugin.class)
            .forEach((name, bean) -> {
                Plugin annotation = bean.getClass().getAnnotation(Plugin.class);
                pluginManager.registerPlugin(annotation.name(), bean);
            });
    }
} 