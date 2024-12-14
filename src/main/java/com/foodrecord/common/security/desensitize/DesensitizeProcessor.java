package com.foodrecord.common.security.desensitize;

import org.springframework.stereotype.Component;

import java.util.regex.Pattern;

/**
 * 脱敏处理器
 * 根据配置的规则对数据进行脱敏处理
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
public class DesensitizeProcessor {
    private final DesensitizeRuleConfig ruleConfig;
    private final DesensitizeRuleCache ruleCache;

    public DesensitizeProcessor(DesensitizeRuleConfig ruleConfig, DesensitizeRuleCache ruleCache) {
        this.ruleConfig = ruleConfig;
        this.ruleCache = ruleCache;
    }

    /**
     * 对数据进行脱敏处理
     *
     * @param value 原始值
     * @param field 字段名
     * @param scene 场景（可选）
     * @return 脱敏后的值
     */
    public String process(String value, String field, String scene) {
        if (!ruleConfig.isEnabled() || value == null || value.isEmpty()) {
            return value;
        }
        
        // 优先从缓存获取场景规则
        DesensitizeRuleConfig.DesensitizeRule rule = null;
        if (scene != null) {
            rule = ruleCache.getSceneRule(scene, field);
        }
        
        // 如果没有场景规则，从缓存获取全局规则
        if (rule == null) {
            rule = ruleCache.getGlobalRule(field);
        }
        
        if (rule == null) {
            return value;
        }
        
        return desensitize(value, rule);
    }
    
    /**
     * 根据规则执行脱敏
     */
    private String desensitize(String value, DesensitizeRuleConfig.DesensitizeRule rule) {
        if (rule.getType() == DesensitizeType.CUSTOM) {
            return Pattern.compile(rule.getPattern())
                .matcher(value)
                .replaceAll(rule.getReplacement());
        }
        
        int length = value.length();
        int keepTotal = rule.getKeepPrefix() + rule.getKeepSuffix();
        if (keepTotal >= length) {
            return value;
        }
        
        StringBuilder result = new StringBuilder();
        result.append(value.substring(0, rule.getKeepPrefix()));
        result.append(rule.getReplacement().repeat(length - keepTotal));
        result.append(value.substring(length - rule.getKeepSuffix()));
        
        return result.toString();
    }
} 