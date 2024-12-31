package com.foodrecord.core.degradation;

import com.foodrecord.controller.user.UserController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class DegradationStrategy {

    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    private final CircuitBreakerManager circuitBreaker;
    private final FallbackManager fallbackManager;

    public DegradationStrategy(CircuitBreakerManager circuitBreaker, FallbackManager fallbackManager) {
        this.circuitBreaker = circuitBreaker;
        this.fallbackManager = fallbackManager;
    }

    public boolean shouldDegrade(String serviceId, ServiceMetrics metrics) {
        // 检查熔断器状态
        if (circuitBreaker.isOpen(serviceId)) {
            logger.warn("Circuit breaker is open for service: {}", serviceId);
            return true;
        }
        
        // 检查服务指标
        if (metrics.getErrorRate() > 0.5 || 
            metrics.getAverageResponseTime() > 1000 ||
            metrics.getConcurrentRequests() > 100) {
            return true;
        }
        
        return false;
    }
    
    public <T> T executeFallback(String serviceId, Class<T> returnType) {
        return fallbackManager.getFallback(serviceId, returnType);
    }
} 