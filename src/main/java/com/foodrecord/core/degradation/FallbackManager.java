package com.foodrecord.core.degradation;

import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class FallbackManager {
    private final Map<String, Map<Class<?>, Object>> fallbacks = new ConcurrentHashMap<>();

    public <T> void registerFallback(String serviceId, Class<T> type, T fallback) {
        fallbacks.computeIfAbsent(serviceId, k -> new ConcurrentHashMap<>())
                .put(type, fallback);
    }

    @SuppressWarnings("unchecked")
    public <T> T getFallback(String serviceId, Class<T> returnType) {
        Map<Class<?>, Object> serviceFallbacks = fallbacks.get(serviceId);
        if (serviceFallbacks != null) {
            Object fallback = serviceFallbacks.get(returnType);
            if (fallback != null && returnType.isInstance(fallback)) {
                return (T) fallback;
            }
        }
        return getDefaultFallback(returnType);
    }

    @SuppressWarnings("unchecked")
    private <T> T getDefaultFallback(Class<T> type) {
        if (type.equals(String.class)) {
            return (T) "Service Unavailable";
        } else if (type.equals(Integer.class)) {
            return (T) Integer.valueOf(-1);
        } else if (type.equals(Long.class)) {
            return (T) Long.valueOf(-1L);
        } else if (type.equals(Boolean.class)) {
            return (T) Boolean.FALSE;
        }
        return null;
    }

    public void clearFallbacks(String serviceId) {
        fallbacks.remove(serviceId);
    }

    public void clearAllFallbacks() {
        fallbacks.clear();
    }
} 