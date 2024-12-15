package com.foodrecord.common.security;

import java.lang.annotation.*;

/**
 * 请求频率限制注解
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RateLimit {
    /**
     * 限制次数
     */
    int limit() default 100;
    
    /**
     * 时间周期（秒）
     */
    int period() default 60;
    
    /**
     * 限制类型
     */
    RateLimitType type() default RateLimitType.IP;
} 