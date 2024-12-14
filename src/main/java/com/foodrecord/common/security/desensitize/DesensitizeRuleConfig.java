package com.foodrecord.common.security.desensitize;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 数据脱敏规则配置类
 * 从配置文件中加载脱敏规则
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
@ConfigurationProperties(prefix = "security.desensitize")
public class DesensitizeRuleConfig {
    /**
     * 是否启用脱敏
     */
    private boolean enabled = true;
    
    /**
     * 全局脱敏规则
     */
    private Map<String, DesensitizeRule> globalRules;
    
    /**
     * 特定场景的脱敏规则
     */
    private Map<String, Map<String, DesensitizeRule>> sceneRules;

    public static class DesensitizeRule {
        /**
         * 脱敏类型
         */
        private DesensitizeType type;
        
        /**
         * 自定义正则表达式（当type=CUSTOM时使用）
         */
        private String pattern;
        
        /**
         * 替换字符
         */
        private String replacement = "*";
        
        /**
         * 保留前几位
         */
        private int keepPrefix = 0;
        
        /**
         * 保留后几位
         */
        private int keepSuffix = 0;
        
        /**
         * 特殊处理的字段
         */
        private List<String> specialFields;

        public DesensitizeType getType() {
            return type;
        }

        public void setType(DesensitizeType type) {
            this.type = type;
        }

        public String getPattern() {
            return pattern;
        }

        public void setPattern(String pattern) {
            this.pattern = pattern;
        }

        public String getReplacement() {
            return replacement;
        }

        public void setReplacement(String replacement) {
            this.replacement = replacement;
        }

        public int getKeepPrefix() {
            return keepPrefix;
        }

        public void setKeepPrefix(int keepPrefix) {
            this.keepPrefix = keepPrefix;
        }

        public int getKeepSuffix() {
            return keepSuffix;
        }

        public void setKeepSuffix(int keepSuffix) {
            this.keepSuffix = keepSuffix;
        }

        public List<String> getSpecialFields() {
            return specialFields;
        }

        public void setSpecialFields(List<String> specialFields) {
            this.specialFields = specialFields;
        }
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Map<String, DesensitizeRule> getGlobalRules() {
        return globalRules;
    }

    public void setGlobalRules(Map<String, DesensitizeRule> globalRules) {
        this.globalRules = globalRules;
    }

    public Map<String, Map<String, DesensitizeRule>> getSceneRules() {
        return sceneRules;
    }

    public void setSceneRules(Map<String, Map<String, DesensitizeRule>> sceneRules) {
        this.sceneRules = sceneRules;
    }
}