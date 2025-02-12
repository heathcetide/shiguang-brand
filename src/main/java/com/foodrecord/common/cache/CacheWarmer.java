package com.foodrecord.common.cache;

import com.foodrecord.common.utils.RedisPipelineUtils;
import com.foodrecord.model.entity.Food;
import com.foodrecord.service.impl.FoodServiceImpl;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component

public class CacheWarmer {
    
    private final FoodServiceImpl foodService;
    private final RedisTemplate<String, Object> redisTemplate;
    private final RedisPipelineUtils pipelineUtils;

    public CacheWarmer(FoodServiceImpl foodService, RedisTemplate<String, Object> redisTemplate, RedisPipelineUtils pipelineUtils) {
        this.foodService = foodService;
        this.redisTemplate = redisTemplate;
        this.pipelineUtils = pipelineUtils;
    }

//    @PostConstruct
//    public void warmUpCache() {
//        System.out.println("开始预热缓存...");
//        warmUpFoodCache();
//        System.out.println("缓存预热完成");
//    }
    
    /**
     * 预热食物数据缓存
     */
    private void warmUpFoodCache() {
        // 获取热门食物
        List<Food> hotFoods = foodService.getHotFoods(100);
        Map<String, Object> foodCache = new HashMap<>();
        
        hotFoods.forEach(food -> 
            foodCache.put("food:" + food.getId(), food));
            
        // 批量写入缓存
        pipelineUtils.batchSet(foodCache, 3600);
    }
} 