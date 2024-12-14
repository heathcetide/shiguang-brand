package com.foodrecord.config;

import org.springframework.cache.interceptor.KeyGenerator;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;

@Component
public class RedisCacheKeyGenerator implements KeyGenerator {
    
    @Override
    public Object generate(Object target, Method method, Object... params) {
        StringBuilder sb = new StringBuilder();
        sb.append(target.getClass().getSimpleName()).append(":");
        sb.append(method.getName()).append(":");
        for (Object param : params) {
            sb.append(param.toString()).append("_");
        }
        return sb.toString();
    }
} 