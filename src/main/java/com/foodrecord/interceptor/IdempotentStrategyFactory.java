package com.foodrecord.interceptor;

import com.foodrecord.common.cache.CacheStrategy;

public class IdempotentStrategyFactory {
    public static IdempotentStrategy createStrategy(String type, CacheStrategy cacheStrategy) {
        switch (type) {
            case "default":
                return new DefaultIdempotentStrategy(cacheStrategy);
            case "requestParam":
                return new RequestParamIdempotentStrategy(cacheStrategy);
            case "requestBody":
                return new RequestBodyIdempotentStrategy(cacheStrategy);
            // 可以添加更多策略
            default:
                throw new IllegalArgumentException("不支持的幂等性策略类型: " + type);
        }
    }
} 