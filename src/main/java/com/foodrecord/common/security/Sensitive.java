package com.foodrecord.common.security;

import java.lang.annotation.*;

/**
 * 敏感数据注解
 * 用于标记需要脱敏的字段
 * 
 * @author yourname
 * @since 1.0.0
 */
@Target({ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Sensitive {
    /**
     * 脱敏类型
     */
    SensitiveType type();
    
    /**
     * 自定义正则表达式（当type=CUSTOM时使用）
     */
    String pattern() default "";
    
    /**
     * 自定义替换字符（当type=CUSTOM时使用）
     */
    String replacement() default "*";
} 