package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.cache.CacheDegradeStrategy;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.lock.RedisDistributedLock;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.monitor.CacheMonitor;
import com.foodrecord.service.FoodService;
import org.springframework.cache.annotation.CacheConfig;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.CachePut;
import org.springframework.cache.annotation.Cacheable;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import javax.annotation.Resource;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Service
@CacheConfig(cacheNames = "food")
public class FoodServiceImpl extends ServiceImpl<FoodMapper, Food> implements FoodService {
    @Resource
    private FoodMapper foodMapper;
    private final RedisUtils redisUtils;
    private final RedisDistributedLock distributedLock;
    private final CacheDegradeStrategy cacheStrategy;
    private final CacheMonitor cacheMonitor;

    private RedisTemplate<String, Object> redisTemplate;
    private static final String FOOD_CACHE_KEY = "food:";
    private static final long FOOD_CACHE_TIME = 3600; // 1小时

    public FoodServiceImpl(RedisUtils redisUtils, RedisDistributedLock distributedLock, CacheDegradeStrategy cacheStrategy, CacheMonitor cacheMonitor) {
        this.redisUtils = redisUtils;
        this.distributedLock = distributedLock;
        this.cacheStrategy = cacheStrategy;
        this.cacheMonitor = cacheMonitor;
    }

    @Cacheable(key = "#id", unless = "#result == null")
    public Food getById(Long id) {
        String key = "food:" + id;
        long startTime = System.currentTimeMillis();
        
        try {
            Food food = cacheStrategy.getWithFallback(
                key,
                Food.class,
                () -> foodMapper.selectById(id)
            );
            
            cacheMonitor.recordCacheOperation(
                food != null,
                System.currentTimeMillis() - startTime
            );
            
            return food;
        } catch (Exception e) {
            log.error("获取食物信息失败", e);
            return null;
        }
    }
    
    @Cacheable(key = "'list:' + #category")
    public List<Food> getByCategory(String category) {
        return foodMapper.selectByCategory(category);
    }
    
    @CachePut(key = "#food.id")
    @Override
    public Food updateFoodById(Food food) {
        String lockKey = "food:lock:" + food.getId();
        String lockValue = UUID.randomUUID().toString();
        
        try {
            // 获取分布式锁
            if (!distributedLock.lock(lockKey, lockValue, 30000)) {
                throw new CustomException("获取锁失败");
            }
            
            // 更新数据
            foodMapper.updateById(food);
            
            // 更新缓存
            redisTemplate.opsForValue().set(
                "food:" + food.getId(),
                food,
                1,
                TimeUnit.HOURS
            );
            
        } finally {
            // 释放锁
            distributedLock.unlock(lockKey, lockValue);
        }
        
        return food;
    }

    @Override
    public Page<Food> getAllFoods(Pageable pageable) {
        Page<Food> page = new Page<>(pageable.getPageNumber() + 1, pageable.getPageSize());
        return this.page(page);
    }

    @Override
    public List<Food> searchFoodsByName(String name) {
        return foodMapper.searchFoodsByName(name);
    }

    @Override
    public Food saveFood(Food food) {
        if (foodMapper.existsByCode(food.getCode())) {
            throw new CustomException("食物编码已存在: " + food.getCode());
        }
        foodMapper.insert(food);
        return food;
    }

    @Override
    public Food findByCode(String code) {
        return foodMapper.selectByCode(code);
    }

    @Transactional
    @Override
    public Food createFood(FoodDTO foodDTO) {
        if (foodMapper.existsByCode(foodDTO.getCode())) {
            throw new CustomException("食物编码已存在");
        }

        Food food = new Food();
        updateFoodFromDTO(food, foodDTO);
        foodMapper.insert(food);
        
        // 添加缓存
        redisUtils.set(FOOD_CACHE_KEY + food.getId(), food, FOOD_CACHE_TIME);
        return food;
    }

    @Transactional
    @Override
    public Food updateFood(Long id, FoodDTO foodDTO) {
        Food food = getFoodById(id);
        
        if (!food.getCode().equals(foodDTO.getCode()) && 
            foodMapper.existsByCode(foodDTO.getCode())) {
            throw new CustomException("食物编码已存在");
        }

        updateFoodFromDTO(food, foodDTO);
        foodMapper.updateById(food);
        
        // 更新缓存
        redisUtils.set(FOOD_CACHE_KEY + id, food, FOOD_CACHE_TIME);
        return food;
    }

    @Override
    public Food getFoodById(Long id) {
        Food food = foodMapper.selectById(id);
        if (food == null) {
            throw new CustomException("未找到指定的食物信息");
        }
        return food;
    }

    @Transactional
    @CacheEvict(key = "#id")
    @Override
    public void deleteFood(Long id) {
        Food food = getFoodById(id);
        foodMapper.deleteById(id);
        // 删除缓存
        redisUtils.delete(FOOD_CACHE_KEY + id);
    }

    @Override
    public List<Food> getHotFoods(int limit) {
        return foodMapper.selectHotFoods(limit);
    }






    @Override
    public Page<Food> getFoods(Page<Food> page, String keyword) {
        return foodMapper.selectFoods(page, keyword);
    }

    @Override
    public boolean deleteFoodById(Long id) {
        Food food = foodMapper.selectById(id);
        if (food == null) {
            return false;
        }
        food.setDeleted(1);
        foodMapper.updateById(food);
        return true;
    }

    @Override
    public void batchDeleteFoods(List<Long> foodIds) {
        foodMapper.batchDelete(foodIds);
    }

    @Override
    public Food toggleFoodStatus(Long id) {
        Food food = foodMapper.selectById(id);
        if (food == null) {
            return null;
        }
        food.setIsAvailable(food.getIsAvailable() == 1 ? 0 : 1);
        foodMapper.updateById(food);
        return food;
    }

    @Override
    public List<Food> searchFoods(String keyword) {
        return foodMapper.searchFoods(keyword);
    }


    private void updateFoodFromDTO(Food food, FoodDTO dto) {
        food.setCode(dto.getCode());
        food.setName(dto.getName());
        food.setHealthLight(dto.getHealthLight());
        food.setHealthLabel(dto.getHealthLabel());
        food.setSuggest(dto.getSuggest());
        food.setThumbImageUrl(dto.getThumbImageUrl());
        food.setLargeImageUrl(dto.getLargeImageUrl());
//        food.setIsDynamicDish(dto.getIsDynamicDish());
        food.setContrastPhotoUrl(dto.getContrastPhotoUrl());
//        food.setIsLiquid(dto.getIsLiquid());
    }
} 