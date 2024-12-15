package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserDietaryGoalsMapper;
import com.foodrecord.model.dto.UserDietaryGoalsDTO;
import com.foodrecord.model.entity.UserDietaryGoals;
import com.foodrecord.service.UserDietaryGoalsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserDietaryGoalsServiceImpl extends ServiceImpl<UserDietaryGoalsMapper, UserDietaryGoals> implements UserDietaryGoalsService {
    private final UserDietaryGoalsMapper goalsMapper;
    private final RedisUtils redisUtils;
    
    private static final String GOALS_CACHE_KEY = "dietary_goals:";
    private static final long GOALS_CACHE_TIME = 3600; // 1小时

    public UserDietaryGoalsServiceImpl(UserDietaryGoalsMapper goalsMapper, RedisUtils redisUtils) {
        this.goalsMapper = goalsMapper;
        this.redisUtils = redisUtils;
    }

    @Override
    public UserDietaryGoals getByUserId(Long userId) {
        String key = GOALS_CACHE_KEY + userId;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (UserDietaryGoals) cached;
        }
        
        UserDietaryGoals goals = goalsMapper.selectByUserId(userId);
        if (goals != null) {
            redisUtils.set(key, goals, GOALS_CACHE_TIME);
        }
        return goals;
    }

    @Override
    @Transactional
    public UserDietaryGoals createOrUpdate(Long userId, UserDietaryGoalsDTO dto) {
        UserDietaryGoals goals = getByUserId(userId);
        if (goals == null) {
            goals = new UserDietaryGoals();
            goals.setUserId(userId);
        }
        
        updateGoalsFromDTO(goals, dto);
        saveOrUpdate(goals);
        
        // 更新缓存
        redisUtils.set(GOALS_CACHE_KEY + userId, goals, GOALS_CACHE_TIME);
        return goals;
    }

    private void updateGoalsFromDTO(UserDietaryGoals goals, UserDietaryGoalsDTO dto) {
        goals.setProteinTarget(dto.getProteinTarget());
        goals.setFatTarget(dto.getFatTarget());
        goals.setCarbTarget(dto.getCarbTarget());
        goals.setFiberTarget(dto.getFiberTarget());
    }
} 