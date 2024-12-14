package com.foodrecord.common.security;

/**
 * 敏感数据类型枚举
 * 定义了常见的敏感数据类型及其脱敏规则
 * 
 * @author yourname
 * @since 1.0.0
 */
public enum SensitiveType {
    /**
     * 手机号码
     * 示例：188****8888
     */
    MOBILE(s -> s.replaceAll("(\\d{3})\\d{4}(\\d{4})", "$1****$2")),
    
    /**
     * 身份证号
     * 示例：110***********1234
     */
    ID_CARD(s -> s.replaceAll("(\\d{3})\\d{11}(\\d{4})", "$1***********$2")),
    
    /**
     * 银行卡号
     * 示例：6222************1234
     */
    BANK_CARD(s -> s.replaceAll("(\\d{4})\\d{8,12}(\\d{4})", "$1********$2")),
    
    /**
     * 姓名
     * 示例：张*
     */
    NAME(s -> s.replaceAll("(.).*", "$1*")),
    
    /**
     * 邮箱
     * 示例：t***@gmail.com
     */
    EMAIL(s -> s.replaceAll("(.).*(@.*)", "$1***$2")),
    
    /**
     * 地址
     * 示例：北京市海******
     */
    ADDRESS(s -> s.replaceAll("(.{6}).*", "$1******")),
    
    /**
     * 自定义
     * 使用自定义的正则表达式和替换规则
     */
    CUSTOM(null);
    
    private final SensitiveStrategy strategy;
    
    SensitiveType(SensitiveStrategy strategy) {
        this.strategy = strategy;
    }
    
    public String desensitize(String value) {
        if (value == null) {
            return null;
        }
        return strategy.desensitize(value);
    }
} 