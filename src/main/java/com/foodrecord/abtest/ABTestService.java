package com.foodrecord.abtest;

import com.foodrecord.abtest.model.Experiment;
import com.foodrecord.abtest.model.ExperimentConfig;
import com.foodrecord.abtest.model.ExperimentResult;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ABTestService {

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String EXPERIMENT_KEY = "abtest:exp:";
    private static final String USER_GROUP_KEY = "abtest:user:";
    private static final String METRIC_KEY = "abtest:metric:";

    /**
     * 创建实验
     */
    public Experiment createExperiment(ExperimentConfig config) {
        // 1. 验证配置
        validateConfig(config);
        
        // 2. 创建实验
        Experiment experiment = new Experiment(
            config.getName(),
            config.getVariants(),
            config.getTrafficPercentage(),
            config.getMetrics()
        );
        
        // 3. 保存实验配置
        String key = EXPERIMENT_KEY + experiment.getId();
        redisTemplate.opsForValue().set(key, experiment);
        
        return experiment;
    }

    /**
     * 获取用户实验组
     */
    public String getUserVariant(String experimentId, Long userId) {
        // 1. 检查用户是否已分组
        String groupKey = USER_GROUP_KEY + experimentId + ":" + userId;
        String variant = (String) redisTemplate.opsForValue().get(groupKey);
        if (variant != null) {
            return variant;
        }
        
        // 2. 获取实验配置
        Experiment experiment = getExperiment(experimentId);
        if (experiment == null || !experiment.isActive()) {
            return null;
        }
        
        // 3. 流量分配
        variant = allocateTraffic(experiment, userId);
        if (variant != null) {
            redisTemplate.opsForValue().set(groupKey, variant);
        }
        
        return variant;
    }

    /**
     * 记录实验指标
     */
    public void trackMetric(String experimentId, Long userId, String metric, double value) {
        // 1. 获取用户实验组
        String variant = getUserVariant(experimentId, userId);
        if (variant == null) {
            return;
        }
        
        // 2. 记录指标数据
        String key = METRIC_KEY + experimentId + ":" + variant + ":" + metric;
        redisTemplate.opsForList().rightPush(key, value);
    }

    /**
     * 获取实验结果
     */
    public ExperimentResult getExperimentResult(String experimentId) {
        // 1. 获取实验配置
        Experiment experiment = getExperiment(experimentId);
        if (experiment == null) {
            return null;
        }
        
        // 2. 收集各组指标数据
        Map<String, Map<String, List<Double>>> variantMetrics = new HashMap<>();
        for (String variant : experiment.getVariants()) {
            Map<String, List<Double>> metrics = new HashMap<>();
            for (String metric : experiment.getMetrics()) {
                String key = METRIC_KEY + experimentId + ":" + variant + ":" + metric;
                List<Double> values = redisTemplate.opsForList()
                    .range(key, 0, -1)
                    .stream()
                    .map(obj -> (Double) obj)
                    .collect(Collectors.toList());
                metrics.put(metric, values);
            }
            variantMetrics.put(variant, metrics);
        }
        
        // 3. 计算统计显著性
        return calculateResults(experiment, variantMetrics);
    }

    private void validateConfig(ExperimentConfig config) {
        // TODO: 实现配置验证逻辑
    }

    private Experiment getExperiment(String experimentId) {
        return (Experiment) redisTemplate.opsForValue().get(EXPERIMENT_KEY + experimentId);
    }

    private String allocateTraffic(Experiment experiment, Long userId) {
        // TODO: 实现流量分配逻辑
        return null;
    }

    private ExperimentResult calculateResults(Experiment experiment,
                                           Map<String, Map<String, List<Double>>> variantMetrics) {
        // TODO: 实现结果计算逻辑
        return null;
    }
} 