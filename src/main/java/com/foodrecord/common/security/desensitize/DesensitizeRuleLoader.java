package com.foodrecord.common.security.desensitize;

import org.springframework.boot.context.event.ApplicationStartedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 脱敏规则加载器
 * 在应用启动时加载和验证脱敏规则
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
public class DesensitizeRuleLoader {
    private final DesensitizeRuleConfig ruleConfig;

    public DesensitizeRuleLoader(DesensitizeRuleConfig ruleConfig) {
        this.ruleConfig = ruleConfig;
    }

    @EventListener(ApplicationStartedEvent.class)
    public void onApplicationStarted() {
        validateRules();
        logRules();
    }
    
    /**
     * 验证脱敏规则的有效性
     */
    private void validateRules() {
        if (ruleConfig.getGlobalRules() != null) {
            for (Map.Entry<String, DesensitizeRuleConfig.DesensitizeRule> entry : 
                    ruleConfig.getGlobalRules().entrySet()) {
                validateRule(entry.getKey(), entry.getValue());
            }
        }
        
        if (ruleConfig.getSceneRules() != null) {
            for (Map.Entry<String, Map<String, DesensitizeRuleConfig.DesensitizeRule>> sceneEntry : 
                    ruleConfig.getSceneRules().entrySet()) {
                for (Map.Entry<String, DesensitizeRuleConfig.DesensitizeRule> ruleEntry : 
                        sceneEntry.getValue().entrySet()) {
                    validateRule(sceneEntry.getKey() + "." + ruleEntry.getKey(), ruleEntry.getValue());
                }
            }
        }
        System.out.println("脱敏规则验证通过");
    }
    
    /**
     * 验证单个脱敏规则
     */
    private void validateRule(String field, DesensitizeRuleConfig.DesensitizeRule rule) {
        if (rule.getType() == DesensitizeType.CUSTOM && 
            (rule.getPattern() == null || rule.getPattern().isEmpty())) {
            throw new IllegalStateException(
                String.format("字段 %s 使用自定义脱敏类型但未指定正则表达式", field));
        }
        
        if (rule.getKeepPrefix() < 0 || rule.getKeepSuffix() < 0) {
            throw new IllegalStateException(
                String.format("字段 %s 的保留位数不能为负数", field));
        }
    }
    
    /**
     * 记录脱敏规则信息
     */
    private void logRules() {
        System.out.println("脱敏功能状态: {}"+ (ruleConfig.isEnabled() ? "启用" : "禁用"));
        
        if (ruleConfig.getGlobalRules() != null) {
            System.out.println("全局脱敏规则:");
            ruleConfig.getGlobalRules().forEach((field, rule) ->
                    System.out.println("  {} -> type={}, keepPrefix={}, keepSuffix={}"+
                    field+ rule.getType()+ rule.getKeepPrefix()+ rule.getKeepSuffix()));
        }
        
        if (ruleConfig.getSceneRules() != null) {
            System.out.println("场景脱敏规则:");
            ruleConfig.getSceneRules().forEach((scene, rules) -> {
                System.out.println("  场景: {}"+ scene);
                rules.forEach((field, rule) ->
                        System.out.println("    {} -> type={}, keepPrefix={}, keepSuffix={}"+
                        field+ rule.getType()+ rule.getKeepPrefix()+ rule.getKeepSuffix()));
            });
        }
    }
} 