package com.foodrecord.common.security.desensitize;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.util.concurrent.TimeUnit;

/**
 * 脱敏规则缓存
 * 使用Caffeine实现本地缓存，提高规则查询性能
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
public class DesensitizeRuleCache {
    private final DesensitizeRuleConfig ruleConfig;
    
    private Cache<String, DesensitizeRuleConfig.DesensitizeRule> globalRuleCache;
    private Cache<String, DesensitizeRuleConfig.DesensitizeRule> sceneRuleCache;

    public DesensitizeRuleCache(DesensitizeRuleConfig ruleConfig) {
        this.ruleConfig = ruleConfig;
    }

    @PostConstruct
    public void init() {
        // 初始化缓存
        globalRuleCache = Caffeine.newBuilder()
                .maximumSize(1000)
                .expireAfterWrite(1, TimeUnit.HOURS)
                .recordStats()
                .build();
                
        sceneRuleCache = Caffeine.newBuilder()
                .maximumSize(5000)
                .expireAfterWrite(1, TimeUnit.HOURS)
                .recordStats()
                .build();
                
        // 预加载全局规则
        if (ruleConfig.getGlobalRules() != null) {
            ruleConfig.getGlobalRules().forEach((field, rule) -> 
                globalRuleCache.put(field, rule));
        }
        
        // 预加载场景规则
        if (ruleConfig.getSceneRules() != null) {
            ruleConfig.getSceneRules().forEach((scene, rules) -> 
                rules.forEach((field, rule) -> 
                    sceneRuleCache.put(buildSceneKey(scene, field), rule)));
        }
        
//        log.info("脱敏规则缓存初始化完成");
    }
    
    /**
     * 获取全局规则
     */
    public DesensitizeRuleConfig.DesensitizeRule getGlobalRule(String field) {
        return globalRuleCache.getIfPresent(field);
    }
    
    /**
     * 获取场景规则
     */
    public DesensitizeRuleConfig.DesensitizeRule getSceneRule(String scene, String field) {
        return sceneRuleCache.getIfPresent(buildSceneKey(scene, field));
    }
    
    /**
     * 更新全局规则
     */
    public void updateGlobalRule(String field, DesensitizeRuleConfig.DesensitizeRule rule) {
        globalRuleCache.put(field, rule);
//        log.info("更新全局脱���规则: field={}, rule={}", field, rule);
    }
    
    /**
     * 更新场景规则
     */
    public void updateSceneRule(String scene, String field, DesensitizeRuleConfig.DesensitizeRule rule) {
        sceneRuleCache.put(buildSceneKey(scene, field), rule);
//        log.info("更新场景脱敏规则: scene={}, field={}, rule={}", scene, field, rule);
    }
    
    /**
     * 删除全局规则
     */
    public void removeGlobalRule(String field) {
        globalRuleCache.invalidate(field);
//        log.info("删除全局脱敏规则: field={}", field);
    }
    
    /**
     * 删除场景规则
     */
    public void removeSceneRule(String scene, String field) {
        sceneRuleCache.invalidate(buildSceneKey(scene, field));
//        log.info("删除场景脱敏规则: scene={}, field={}", scene, field);
    }
    
    /**
     * 清空所有规则缓存
     */
    public void clearAll() {
        globalRuleCache.invalidateAll();
        sceneRuleCache.invalidateAll();
//        log.info("清空所有脱敏规则缓存");
    }
    
    /**
     * 获取缓存统计信息
     */
    public String getStats() {
        return String.format("全局规则缓存统计: %s\n场景规则缓存统计: %s",
            globalRuleCache.stats().toString(),
            sceneRuleCache.stats().toString());
    }
    
    private String buildSceneKey(String scene, String field) {
        return scene + ":" + field;
    }
} 