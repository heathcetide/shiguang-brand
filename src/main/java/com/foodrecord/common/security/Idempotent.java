package com.foodrecord.common.security;

import java.lang.annotation.*;

/**
 * 接口幂等性注解
 * 用于标记需要保证幂等性的接口方法
 * 
 * @author yourname
 * @since 1.0.0
 */
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Idempotent {
    /**
     * 幂等性标识的超时时间（秒）
     * 超过这个时间后标识失效，可以再次请求
     */
    int expire() default 3600;

    /**
     * 防抖和节流的超时时间（秒）
     */
    int timeout() default 1; // 默认1秒

    /**
     * 幂等性标识的前缀
     */
    String prefix() default "idempotent";

    /**
     * 提示信息
     */
    String message() default "请求正在处理中，请勿重复提交";

    /**
     * 幂等性标识来源
     */
    IdempotentType type() default IdempotentType.HEADER;

    /**
     * 幂等性标识来源
     */
    String identifier() default "";
} 