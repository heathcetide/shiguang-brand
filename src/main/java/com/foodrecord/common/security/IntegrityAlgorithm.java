package com.foodrecord.common.security;

/**
 * 数据完整性校验算法枚举
 * 
 * @author yourname
 * @since 1.0.0
 */
public enum IntegrityAlgorithm {
    /**
     * MD5算法
     */
    MD5,
    
    /**
     * SHA-256算法
     */
    SHA256,
    
    /**
     * HMAC-SHA256算法
     */
    HMAC_SHA256,
    
    /**
     * CRC32算法
     */
    CRC32
} 