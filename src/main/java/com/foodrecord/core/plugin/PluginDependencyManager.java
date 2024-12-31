package com.foodrecord.core.plugin;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class PluginDependencyManager {
    private final Map<String, Set<String>> dependencies = new HashMap<>();
    private final Map<String, Set<String>> dependents = new HashMap<>();
    
    public void addDependency(String plugin, String dependency) {
        dependencies.computeIfAbsent(plugin, k -> new HashSet<>()).add(dependency);
        dependents.computeIfAbsent(dependency, k -> new HashSet<>()).add(plugin);
    }
    
    public List<String> getLoadOrder() {
        List<String> order = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        Set<String> visiting = new HashSet<>();
        
        dependencies.keySet().forEach(plugin -> 
            visit(plugin, visited, visiting, order));
            
        Collections.reverse(order);
        return order;
    }
    
    private void visit(String plugin, Set<String> visited, 
                      Set<String> visiting, List<String> order) {
        if (visiting.contains(plugin)) {
            throw new IllegalStateException("Circular dependency detected: " + plugin);
        }
        if (visited.contains(plugin)) {
            return;
        }
        
        visiting.add(plugin);
        dependencies.getOrDefault(plugin, Collections.emptySet())
            .forEach(dep -> visit(dep, visited, visiting, order));
        visiting.remove(plugin);
        
        visited.add(plugin);
        order.add(plugin);
    }
} 