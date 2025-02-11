package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserDietaryGoalsMapper;
import com.foodrecord.model.dto.UserDietaryGoalsDTO;
import com.foodrecord.model.entity.UserDietaryGoals;
import com.foodrecord.service.UserDietaryGoalsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class UserDietaryGoalsServiceImpl extends ServiceImpl<UserDietaryGoalsMapper, UserDietaryGoals> implements UserDietaryGoalsService {
    private static final String GOALS_CACHE_KEY = "dietary_goals:";
    private static final long GOALS_CACHE_TIME = 3600; // 1小时缓存时间

    @Resource
    private UserDietaryGoalsMapper goalsMapper;

    @Resource
    private RedisUtils redisUtils;

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

    /**
     * 将 DTO 的数据映射到目标实体
     */
    private void updateGoalsFromDTO(UserDietaryGoals goals, UserDietaryGoalsDTO dto) {
        goals.setGoalCategory(dto.getGoalCategory());
        goals.setTargetWeight(dto.getTargetWeight());
        goals.setTargetBloodPressureHigh(dto.getTargetBloodPressureHigh());
        goals.setTargetBloodPressureLow(dto.getTargetBloodPressureLow());
        goals.setTargetBloodSugar(dto.getTargetBloodSugar());
        goals.setTargetBodyFat(dto.getTargetBodyFat());
        goals.setTargetProtein(dto.getTargetProtein());
        goals.setTargetFat(dto.getTargetFat());
        goals.setTargetCarb(dto.getTargetCarb());
        goals.setTargetFiber(dto.getTargetFiber());
        goals.setNotes(dto.getNotes());
        goals.setStartDate(dto.getStartDate());
        goals.setEndDate(dto.getEndDate());
    }
}
