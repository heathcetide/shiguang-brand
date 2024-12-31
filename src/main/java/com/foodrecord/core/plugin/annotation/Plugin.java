package com.foodrecord.core.plugin.annotation;

import java.lang.annotation.*;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Plugin {
    String name();
    String version() default "1.0";
    String description() default "";
} 