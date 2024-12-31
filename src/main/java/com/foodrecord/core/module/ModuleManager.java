package com.foodrecord.core.module;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class ModuleManager {
    private final Map<String, Object> modules = new HashMap<>();
    private final Set<String> enabledModules = new HashSet<>();

    public void registerModule(String name, Object module) {
        modules.put(name, module);
    }

    public void enableModule(String name) {
        if (modules.containsKey(name)) {
            enabledModules.add(name);
        }
    }

    public boolean isModuleEnabled(String name) {
        return enabledModules.contains(name);
    }
} 