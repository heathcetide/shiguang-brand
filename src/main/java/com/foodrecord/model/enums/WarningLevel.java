package com.foodrecord.model.enums;

/**
 * 健康警告级别枚举
 */
public enum WarningLevel {
    /**
     * 提示级别
     * 轻微的营养不均衡或饮食习惯问题
     */
    INFO,
    
    /**
     * 警告级别
     * 明显的营养失衡或不良饮食习惯
     */
    WARNING,
    
    /**
     * 严重级别
     * 严重的营养问题或健康隐患
     */
    SEVERE,
    
    /**
     * 危险级别
     * 需要立即就医或调整的健康问题
     */
    DANGER
} 