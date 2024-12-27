package com.foodrecord.abtest.monitor;

import com.foodrecord.abtest.model.Experiment;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Component
public class ExperimentMonitor {

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String MONITOR_KEY = "abtest:monitor:";
    private static final String HEALTH_CHECK_KEY = "abtest:health:";
    private static final double SAMPLE_SIZE_THRESHOLD = 0.1; // 最小样本量阈值
    private static final double METRIC_ANOMALY_THRESHOLD = 3.0; // 异常值标准差倍数

    /**
     * 监控实验健康状况
     */
    @Scheduled(fixedRate = 300000) // 每5分钟执行一次
    public void monitorExperiments() {
        // 1. 获取所有运行中的实验
        List<Experiment> activeExperiments = getActiveExperiments();
        
        for (Experiment experiment : activeExperiments) {
            // 2. 检查实验健康状况
            ExperimentHealth health = checkExperimentHealth(experiment);
            
            // 3. 记录监控结果
            recordHealthCheck(experiment.getId(), health);
            
            // 4. 处理异常情况
            handleHealthIssues(experiment, health);
        }
    }

    private ExperimentHealth checkExperimentHealth(Experiment experiment) {
        ExperimentHealth health = new ExperimentHealth();
        
        // 1. 检查样本量
        checkSampleSize(experiment, health);
        
        // 2. 检查指标异常
        checkMetricAnomalies(experiment, health);
        
        // 3. 检查流量分配
        checkTrafficAllocation(experiment, health);
        
        // 4. 检查数据质量
        checkDataQuality(experiment, health);
        
        return health;
    }

    private void checkSampleSize(Experiment experiment, ExperimentHealth health) {
        Map<String, Long> variantSizes = getVariantSampleSizes(experiment.getId());
        long totalSamples = variantSizes.values().stream().mapToLong(Long::longValue).sum();
        
        // 检查总样本量是否达到最小要求
        health.setSampleSizeAdequate(totalSamples >= experiment.getMinSampleSize());
        
        // ���查各变体样本量是否均衡
        double expectedRatio = 1.0 / experiment.getVariants().size();
        for (Map.Entry<String, Long> entry : variantSizes.entrySet()) {
            double actualRatio = entry.getValue() / (double) totalSamples;
            if (Math.abs(actualRatio - expectedRatio) > 0.1) {
                health.addIssue("Uneven traffic split in variant: " + entry.getKey());
            }
        }
    }

    private void checkMetricAnomalies(Experiment experiment, ExperimentHealth health) {
        for (String metric : experiment.getMetrics()) {
            Map<String, List<Double>> values = getMetricValues(experiment.getId(), metric);
            
            for (Map.Entry<String, List<Double>> entry : values.entrySet()) {
                // 检查异常值
                List<Double> anomalies = detectAnomalies(entry.getValue());
                if (!anomalies.isEmpty()) {
                    health.addIssue(String.format(
                        "Metric anomalies detected in %s for variant %s",
                        metric, entry.getKey()
                    ));
                }
            }
        }
    }

    private List<Double> detectAnomalies(List<Double> values) {
        List<Double> anomalies = new ArrayList<>();
        if (values.isEmpty()) return anomalies;
        
        // 计算均值和标准差
        double mean = values.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
        double stdDev = calculateStdDev(values, mean);
        
        // 检测异常值(超过3个标准差)
        for (Double value : values) {
            if (Math.abs(value - mean) > METRIC_ANOMALY_THRESHOLD * stdDev) {
                anomalies.add(value);
            }
        }
        
        return anomalies;
    }

    private double calculateStdDev(List<Double> values, double mean) {
        return Math.sqrt(values.stream()
            .mapToDouble(v -> Math.pow(v - mean, 2))
            .average()
            .orElse(0.0));
    }

    private void recordHealthCheck(String experimentId, ExperimentHealth health) {
        String key = HEALTH_CHECK_KEY + experimentId;
        redisTemplate.opsForValue().set(key, health);
        redisTemplate.expire(key, 7, TimeUnit.DAYS);
    }

    private void handleHealthIssues(Experiment experiment, ExperimentHealth health) {
        if (!health.isHealthy()) {
            // 1. 记录问题
            logHealthIssues(experiment, health);
            
            // 2. 发送告警
            sendHealthAlert(experiment, health);
            
            // 3. 自动干预
            if (health.isCritical()) {
                autoIntervention(experiment);
            }
        }
    }

    private void logHealthIssues(Experiment experiment, ExperimentHealth health) {
        // TODO: 实现健康问题日志记录
    }

    private void sendHealthAlert(Experiment experiment, ExperimentHealth health) {
        // TODO: 实现健康告警通知
    }

    private void autoIntervention(Experiment experiment) {
        // TODO: 实现自动干预策略
    }

    private List<Experiment> getActiveExperiments() {
        // 模拟从数据库或缓存中获取所有活动实验
        List<Experiment> experiments = new ArrayList<>();
        experiments.add(new Experiment(
                "实验A",
                Arrays.asList("Variant1", "Variant2"),
                1.0,
                Arrays.asList("CTR", "ConversionRate")
        ));
        experiments.add(new Experiment(
                "实验B",
                Arrays.asList("Control", "Treatment"),
                0.5,
                Arrays.asList("BounceRate", "Revenue")
        ));
        return experiments;
    }

    private Map<String, Long> getVariantSampleSizes(String experimentId) {
        // 模拟从 Redis 或数据库中获取每个变体的样本量
        Map<String, Long> variantSizes = new HashMap<>();
        variantSizes.put("Variant1", 1000L);
        variantSizes.put("Variant2", 950L);
        return variantSizes;
    }

    private Map<String, List<Double>> getMetricValues(String experimentId, String metric) {
        // 模拟从数据库中获取指标的时间序列数据
        Map<String, List<Double>> metricValues = new HashMap<>();
        metricValues.put("Variant1", Arrays.asList(0.12, 0.15, 0.13, 0.16));
        metricValues.put("Variant2", Arrays.asList(0.10, 0.09, 0.11, 0.12));
        return metricValues;
    }

    private void checkTrafficAllocation(Experiment experiment, ExperimentHealth health) {
        // 检查流量分配是否符合预期
        double totalTraffic = experiment.getTrafficPercentage();
        if (totalTraffic <= 0 || totalTraffic > 1.0) {
            health.addIssue("Traffic allocation for the experiment is invalid.");
        }
    }

    private void checkDataQuality(Experiment experiment, ExperimentHealth health) {
        // 模拟检查数据质量，例如数据缺失率
        double missingDataRate = 0.05; // 假设 5% 数据丢失
        if (missingDataRate > 0.1) {
            health.addIssue("Data quality issue: Missing data rate is too high.");
        }
    }

} 