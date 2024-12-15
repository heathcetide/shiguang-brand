package com.foodrecord.common.security;

import java.lang.annotation.*;

/**
 * 数据完整性校验注解
 * 用于标记需要进行数据完整性校验的方法或字段
 * 
 * @author yourname
 * @since 1.0.0
 */
@Target({ElementType.METHOD, ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface DataIntegrity {
    /**
     * 校验算法
     */
    IntegrityAlgorithm algorithm() default IntegrityAlgorithm.MD5;
    
    /**
     * 是否包含时间戳
     */
    boolean includeTimestamp() default false;
    
    /**
     * 密钥（用于HMAC算法）
     */
    String secretKey() default "";
    
    /**
     * 校验失败时的提示信息
     */
    String message() default "数据完整性校验失败";
} 