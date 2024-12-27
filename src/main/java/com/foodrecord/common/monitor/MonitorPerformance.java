package com.foodrecord.common.monitor;

import java.lang.annotation.*;

/**
 * 性能监控注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface MonitorPerformance {
    String value() default "";
} 