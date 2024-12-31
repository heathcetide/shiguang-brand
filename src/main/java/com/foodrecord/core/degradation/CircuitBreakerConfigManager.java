package com.foodrecord.core.degradation;

import com.foodrecord.common.monitor.MetricsCollector;
import com.foodrecord.core.flow.performance.PerformanceMetrics;
import com.foodrecord.risk.model.RiskAssessment;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;


@Component
public class CircuitBreakerConfigManager {
    private final ConcurrentHashMap<String, DynamicConfig> serviceConfigs;
    private final MetricsCollector metricsCollector;
    private final ConfigurationOptimizer configOptimizer;

    public CircuitBreakerConfigManager(
            MetricsCollector metricsCollector,
            ConfigurationOptimizer configOptimizer) {
        this.serviceConfigs = new ConcurrentHashMap<>();
        this.metricsCollector = metricsCollector;
        this.configOptimizer = configOptimizer;
    }

    public static class DynamicConfig {
        private volatile double failureThreshold;
        private volatile long resetTimeout;
        private volatile int samplingWindowSize;
        private volatile double errorRateThreshold;
        private final Map<String, Double> serviceSpecificThresholds;
        private volatile double latencyThreshold;
        private volatile double successThreshold;

        public DynamicConfig(Map<String, Double> serviceSpecificThresholds) {
            this.serviceSpecificThresholds = serviceSpecificThresholds;
            this.latencyThreshold = 1000; // 默认1秒
            this.successThreshold = 0.95; // 默认95%成功率
        }

        public void adjustThresholds(PerformanceMetrics metrics) {
            // 动态调整阈值
            if (metrics.getLatencyP99() > latencyThreshold) {
                increaseProtectionLevel();
            } else if (metrics.getSuccessRate() > successThreshold) {
                decreaseProtectionLevel();
            }
        }
        
        private synchronized void increaseProtectionLevel() {
            failureThreshold *= 0.8; // 降低失败阈值
            resetTimeout *= 1.2;     // 增加重置时间
            notifyConfigChange();
        }

        private synchronized void decreaseProtectionLevel() {
            failureThreshold *= 1.2; // 提高失败阈值
            resetTimeout *= 0.8;     // 减少重置时间
            notifyConfigChange();
        }

        private void notifyConfigChange() {
            // 通知配置变更
        }

        public double getFailureThreshold() {
            return failureThreshold;
        }

        public void setFailureThreshold(double failureThreshold) {
            this.failureThreshold = failureThreshold;
        }

        public long getResetTimeout() {
            return resetTimeout;
        }

        public void setResetTimeout(long resetTimeout) {
            this.resetTimeout = resetTimeout;
        }

        public int getSamplingWindowSize() {
            return samplingWindowSize;
        }

        public void setSamplingWindowSize(int samplingWindowSize) {
            this.samplingWindowSize = samplingWindowSize;
        }

        public double getErrorRateThreshold() {
            return errorRateThreshold;
        }

        public void setErrorRateThreshold(double errorRateThreshold) {
            this.errorRateThreshold = errorRateThreshold;
        }

        public Map<String, Double> getServiceSpecificThresholds() {
            return serviceSpecificThresholds;
        }
    }
    
    public void optimizeConfigs() {
        serviceConfigs.forEach((serviceId, config) -> {
            ServiceMetrics metrics = metricsCollector.getMetrics(serviceId);
            OptimizationResult result = configOptimizer.optimize(metrics);
            
            if (result.shouldApply()) {
                applyOptimization(serviceId, result);
                monitorOptimizationEffect(serviceId, result);
            }
        });
    }

    private void applyOptimization(String serviceId, OptimizationResult result) {
        DynamicConfig config = serviceConfigs.get(serviceId);
        if (config != null) {
            result.getOptimizedThresholds().forEach((key, value) -> {
                config.getServiceSpecificThresholds().put(key, value);
            });
        }
    }

    private void monitorOptimizationEffect(String serviceId, OptimizationResult result) {
        // 监控优化效果的实现
    }

    public static class OptimizationResult {
        private final Map<String, Double> optimizedThresholds;
        private final double expectedImprovementRate;
        private final List<String> optimizationReasons;
        private final RiskAssessment riskAssessment;

        public OptimizationResult(
                Map<String, Double> optimizedThresholds,
                double expectedImprovementRate,
                List<String> optimizationReasons,
                RiskAssessment riskAssessment) {
            this.optimizedThresholds = optimizedThresholds;
            this.expectedImprovementRate = expectedImprovementRate;
            this.optimizationReasons = optimizationReasons;
            this.riskAssessment = riskAssessment;
        }

        public boolean shouldApply() {
            return expectedImprovementRate > 0.1 && // 预期改善率大于10%
                    riskAssessment.getLevel().getSeverity() <= 3; // 调用 RiskLevel 的 getSeverity
        }

        public Map<String, Double> getOptimizedThresholds() {
            return optimizedThresholds;
        }

        public double getExpectedImprovementRate() {
            return expectedImprovementRate;
        }

        public List<String> getOptimizationReasons() {
            return optimizationReasons;
        }

        public RiskAssessment getRiskAssessment() {
            return riskAssessment;
        }
    }
} 