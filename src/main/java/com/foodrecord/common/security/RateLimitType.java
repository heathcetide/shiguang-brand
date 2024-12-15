package com.foodrecord.common.security;

/**
 * 频率限制类型
 */
public enum RateLimitType {
    /**
     * 基于IP地址限制
     */
    IP,
    
    /**
     * 基于用户ID限制
     */
    USER,
    
    /**
     * 基于接口限制
     */
    INTERFACE
} 