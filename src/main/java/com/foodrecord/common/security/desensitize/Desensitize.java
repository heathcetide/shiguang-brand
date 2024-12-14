package com.foodrecord.common.security.desensitize;

import java.lang.annotation.*;

/**
 * 数据脱敏注解
 * 用于标记需要进行脱敏处理的字段
 * 
 * @author yourname
 * @since 1.0.0
 */
@Target({ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Desensitize {
    /**
     * 脱敏类型
     */
    DesensitizeType type();
    
    /**
     * 场景
     */
    String scene() default "";
    
    /**
     * 自定义正则表达式（当type=CUSTOM时使用）
     */
    String pattern() default "";
    
    /**
     * 替换字符
     */
    String replacement() default "*";
    
    /**
     * 保留前几位
     */
    int keepPrefix() default -1;
    
    /**
     * 保留后几位
     */
    int keepSuffix() default -1;
} 