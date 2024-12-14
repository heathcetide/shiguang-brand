package com.foodrecord.common.security;

/**
 * 敏感数据脱敏策略接口
 * 
 * @author yourname
 * @since 1.0.0
 */
@FunctionalInterface
public interface SensitiveStrategy {
    /**
     * 执行脱敏操作
     *
     * @param value 原始值
     * @return 脱敏后的值
     */
    String desensitize(String value);
} 