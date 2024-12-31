package com.foodrecord.core.module.annotation;

import java.lang.annotation.*;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Module {
    String name();
    String[] dependencies() default {};
} 