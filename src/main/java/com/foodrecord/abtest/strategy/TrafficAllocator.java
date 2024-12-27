package com.foodrecord.abtest.strategy;

import com.foodrecord.abtest.model.Experiment;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Random;

@Component
public class TrafficAllocator {
    
    private final Random random = new Random();

    /**
     * 分配用户到实验组
     */
    public String allocate(Experiment experiment, Long userId) {
        // 1. 检查流量百分比
        if (random.nextDouble() > experiment.getTrafficPercentage()) {
            return null; // 用户不参与实验
        }
        
        // 2. 获取可用变体
        List<String> variants = experiment.getVariants();
        if (variants.isEmpty()) {
            return null;
        }
        
        // 3. 确定性分配(基于用户ID)
        int index = Math.abs(userId.hashCode()) % variants.size();
        return variants.get(index);
    }
} 