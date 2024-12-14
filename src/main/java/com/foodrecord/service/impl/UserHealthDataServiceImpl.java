package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.mapper.UserHealthDataMapper;
import com.foodrecord.mapper.UserMapper;
import com.foodrecord.model.dto.UserHealthDataDTO;
import com.foodrecord.model.entity.User;
import com.foodrecord.model.entity.UserHealthData;
import com.foodrecord.service.UserHealthDataService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class UserHealthDataServiceImpl extends ServiceImpl<UserHealthDataMapper, UserHealthData> implements UserHealthDataService {
    @Resource
    private UserHealthDataMapper healthDataMapper;
    @Resource
    private UserMapper userMapper;

    @Override
    public UserHealthData getUserHealthData(Long userId) {
        return healthDataMapper.findByUserId(userId)
                .orElseThrow(() -> new CustomException("用户健康数据不存在"));
    }

    @Override
    @Transactional
    public UserHealthData createUserHealthData(Long userId, UserHealthDataDTO healthDataDTO) {
        if (healthDataMapper.existsByUserId(userId)) {
            throw new CustomException("用户健康数据已存在");
        }

        User user = userMapper.findById(userId)
                .orElseThrow(() -> new CustomException("用户不存在"));

        UserHealthData healthData = new UserHealthData();
        healthData.setUser(user);
        updateHealthDataFromDTO(healthData, healthDataDTO);
        calculateDailyCalorieTarget(healthData);
        int insert = healthDataMapper.insert(healthData);
        return healthData;
    }

    @Override
    @Transactional
    public UserHealthData updateUserHealthData(Long userId, UserHealthDataDTO healthDataDTO) {
        UserHealthData healthData = getUserHealthData(userId);
        updateHealthDataFromDTO(healthData, healthDataDTO);
        calculateDailyCalorieTarget(healthData);
        int insert = healthDataMapper.insert(healthData);
        return healthData;
    }

    private void updateHealthDataFromDTO(UserHealthData healthData, UserHealthDataDTO dto) {
        healthData.setHeight(dto.getHeight());
        healthData.setWeight(dto.getWeight());
        healthData.setAge(dto.getAge());
        healthData.setGender(dto.getGender());
        healthData.setActivityLevel(dto.getActivityLevel());
        healthData.setHealthGoal(dto.getHealthGoal());
    }

    private void calculateDailyCalorieTarget(UserHealthData healthData) {
        // 使用Harris-Benedict公式计算基础代谢率(BMR)
        double bmr;
        if ("male".equalsIgnoreCase(healthData.getGender())) {
            bmr = 66 + (13.7 * healthData.getWeight()) + 
                  (5 * healthData.getHeight()) - (6.8 * healthData.getAge());
        } else {
            bmr = 655 + (9.6 * healthData.getWeight()) + 
                  (1.8 * healthData.getHeight()) - (4.7 * healthData.getAge());
        }

        // 根据活动水平调整
        double activityMultiplier;
        switch (healthData.getActivityLevel()) {
            case 1:
                activityMultiplier = 1.2; // 久坐
                break;
            case 2:
                activityMultiplier =1.375;  // 轻度活动
                break;
            case 3 :
                activityMultiplier =1.55;  // 中度活动
                break;
            case 4 :
                activityMultiplier = 1.725;  // 重度活动
                break;
            default :
                activityMultiplier =1.2;
        }

        double tdee = bmr * activityMultiplier;  // 每日总能量消耗

        // 根据健康目标调整卡路里目标
        switch (healthData.getHealthGoal().toLowerCase()) {
            case "减重":
                tdee *= 0.8;  // 减少20%卡路里
                break;
            case "增重" :
                tdee *= 1.2;  // 增加20%卡路里
                break;
            case "维持" :
                break;// 保持不变
            default :
                break;
        }

        healthData.setDailyCalorieTarget((int) tdee);
    }
} 