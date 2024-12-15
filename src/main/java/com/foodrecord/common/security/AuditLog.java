package com.foodrecord.common.security;

import java.lang.annotation.*;

/**
 * 操作审计日志注解
 * 用于标记需要记录审计日志的方法
 * 
 * @author yourname
 * @since 1.0.0
 */
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AuditLog {
    /**
     * 操作类型
     */
    String operation();
    
    /**
     * 操作描述
     */
    String description() default "";
    
    /**
     * 是否记录请求参数
     */
    boolean recordParams() default true;
    
    /**
     * 是否记录响应结果
     */
    boolean recordResult() default false;
    
    /**
     * 是否记录异常信息
     */
    boolean recordException() default true;
} 