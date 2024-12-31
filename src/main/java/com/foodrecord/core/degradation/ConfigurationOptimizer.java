package com.foodrecord.core.degradation;

import org.springframework.stereotype.Service;

public interface ConfigurationOptimizer {
    CircuitBreakerConfigManager.OptimizationResult optimize(ServiceMetrics metrics);
} 