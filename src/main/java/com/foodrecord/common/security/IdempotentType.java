package com.foodrecord.common.security;

/**
 * 幂等性标识来源类型
 * 
 * @author yourname
 * @since 1.0.0
 */
public enum IdempotentType {
    /**
     * 从请求头获取标识
     */
    HEADER,
    
    /**
     * 从请求参数获取标识
     */
    PARAM,
    
    /**
     * 从请求体获取标识
     */
    BODY,
    
    /**
     * 自动生成标识
     */
    AUTO
} 