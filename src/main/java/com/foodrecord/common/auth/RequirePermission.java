package com.foodrecord.common.auth;

import java.lang.annotation.*;

@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RequirePermission {
    String[] value();
    boolean requireAll() default false; // true表示需要所有权限，false表示只需要其中一个权限
} 