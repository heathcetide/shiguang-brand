package com.foodrecord.common.security.desensitize;

/**
 * 脱敏类型枚举
 * 定义了系统支持的脱敏类型
 * 
 * @author yourname
 * @since 1.0.0
 */
public enum DesensitizeType {
    /**
     * 手机号码
     * 示例：188****8888
     */
    MOBILE(3, 4),
    
    /**
     * 身份证号
     * 示例：110***********1234
     */
    ID_CARD(3, 4),
    
    /**
     * 银行卡号
     * 示例：6222************1234
     */
    BANK_CARD(4, 4),
    
    /**
     * 姓名
     * 示例：张*
     */
    NAME(1, 0),
    
    /**
     * 邮箱
     * 示例：t***@gmail.com
     */
    EMAIL(1, 0),
    
    /**
     * 地址
     * 示例：北京市海******
     */
    ADDRESS(6, 0),
    
    /**
     * 自定义
     * 使用自定义的正则表达式和替换规则
     */
    CUSTOM(0, 0);
    
    private final int defaultKeepPrefix;
    private final int defaultKeepSuffix;
    
    DesensitizeType(int defaultKeepPrefix, int defaultKeepSuffix) {
        this.defaultKeepPrefix = defaultKeepPrefix;
        this.defaultKeepSuffix = defaultKeepSuffix;
    }
    
    public int getDefaultKeepPrefix() {
        return defaultKeepPrefix;
    }
    
    public int getDefaultKeepSuffix() {
        return defaultKeepSuffix;
    }
} 