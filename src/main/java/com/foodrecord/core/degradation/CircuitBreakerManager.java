package com.foodrecord.core.degradation;

import org.springframework.stereotype.Component;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class CircuitBreakerManager {
    private final ConcurrentHashMap<String, CircuitBreaker> breakers = new ConcurrentHashMap<>();
    private final CircuitBreakerConfig defaultConfig;

    public CircuitBreakerManager() {
        this.defaultConfig = CircuitBreakerConfig.custom()
            .failureThreshold(5)
            .resetTimeout(60000)
            .samplingWindowSize(100)
            .errorThresholdPercentage(50.0)
            .build();
    }

    public CircuitBreaker getOrCreate(String serviceId) {
        return breakers.computeIfAbsent(serviceId, 
            id -> new CircuitBreaker(id, defaultConfig));
    }

    public CircuitBreaker getOrCreate(String serviceId, CircuitBreakerConfig config) {
        return breakers.computeIfAbsent(serviceId, 
            id -> new CircuitBreaker(id, config));
    }

    public boolean isOpen(String serviceId) {
        CircuitBreaker breaker = breakers.get(serviceId);
        return breaker != null && breaker.getState() == CircuitBreakerState.OPEN;
    }

    public static class CircuitBreaker {
        private final String serviceId;
        private volatile CircuitBreakerState state = CircuitBreakerState.CLOSED;
        private final AtomicInteger failureCount = new AtomicInteger(0);
        private volatile long lastStateChangeTime;
        private final CircuitBreakerConfig config;

        public CircuitBreaker(String serviceId, CircuitBreakerConfig config) {
            this.serviceId = serviceId;
            this.config = config;
            this.lastStateChangeTime = System.currentTimeMillis();
        }

        public synchronized boolean tryPass() {
            switch (state) {
                case CLOSED:
                    return true;
                case OPEN:
                    if (System.currentTimeMillis() - lastStateChangeTime > config.getResetTimeout()) {
                        state = CircuitBreakerState.HALF_OPEN;
                        lastStateChangeTime = System.currentTimeMillis();
                        return true;
                    }
                    return false;
                case HALF_OPEN:
                    return true;
                default:
                    return false;
            }
        }
        
        public synchronized void recordSuccess() {
            if (state == CircuitBreakerState.HALF_OPEN) {
                state = CircuitBreakerState.CLOSED;
                failureCount.set(0);
                lastStateChangeTime = System.currentTimeMillis();
            }
        }
        
        public synchronized void recordFailure() {
            if (state == CircuitBreakerState.CLOSED) {
                if (failureCount.incrementAndGet() >= config.getFailureThreshold()) {
                    state = CircuitBreakerState.OPEN;
                    lastStateChangeTime = System.currentTimeMillis();
                }
            } else if (state == CircuitBreakerState.HALF_OPEN) {
                state = CircuitBreakerState.OPEN;
                lastStateChangeTime = System.currentTimeMillis();
            }
        }

        public String getServiceId() {
            return serviceId;
        }

        public CircuitBreakerState getState() {
            return state;
        }

        public void setState(CircuitBreakerState state) {
            this.state = state;
        }

        public AtomicInteger getFailureCount() {
            return failureCount;
        }

        public long getLastStateChangeTime() {
            return lastStateChangeTime;
        }

        public void setLastStateChangeTime(long lastStateChangeTime) {
            this.lastStateChangeTime = lastStateChangeTime;
        }

        public CircuitBreakerConfig getConfig() {
            return config;
        }
    }
    
    public enum CircuitBreakerState {
        CLOSED, OPEN, HALF_OPEN
    }
} 