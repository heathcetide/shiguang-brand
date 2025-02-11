package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.exception.CustomException;
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

        // 检查用户是否存在
        User user = userMapper.findById(userId)
                .orElseThrow(() -> new CustomException("用户不存在"));

        // 创建健康数据实体
        UserHealthData healthData = new UserHealthData();
        healthData.setName(user.getUsername());
        healthData.setUserId(userId); // 设置用户ID
        updateHealthDataFromDTO(healthData, healthDataDTO);
        calculateDailyCalorieTarget(healthData);

        healthDataMapper.insert(healthData);
        return healthData;
    }

    @Override
    @Transactional
    public UserHealthData updateUserHealthData(Long userId, UserHealthDataDTO healthDataDTO) {
        try {
            UserHealthData healthData = getUserHealthData(userId);
            updateHealthDataFromDTO(healthData, healthDataDTO);
            calculateDailyCalorieTarget(healthData);

            healthDataMapper.updateById(healthData); // 使用 updateById 更新记录
            return healthData;
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    /**
     * 根据健康目标计算每日卡路里目标
     */
    private void calculateDailyCalorieTarget(UserHealthData healthData) {
        // 使用 Harris-Benedict 公式计算基础代谢率 (BMR)
        double bmr;
        if (healthData.getGender() == 1) {
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
                activityMultiplier = 1.375; // 轻度活动
                break;
            case 3:
                activityMultiplier = 1.55; // 中度活动
                break;
            case 4:
                activityMultiplier = 1.725; // 重度活动
                break;
            default:
                activityMultiplier = 1.2; // 默认值
        }

        // 每日总能量消耗 (TDEE)
        double tdee = bmr * activityMultiplier;

        // 根据健康目标调整卡路里目标
//        switch (healthData.getDailyCalorieTarget()) {
//            case "减重":
//                tdee *= 0.8; // 减少20%卡路里
//                break;
//            case "增重":
//                tdee *= 1.2; // 增加20%卡路里
//                break;
//            case "健康维持":
//            default:
//                // 不做额外调整
//                break;
//        }

        healthData.setDailyCalorieTarget((int) tdee);
    }


    /**
     * 从 DTO 更新实体类数据
     */
    private void updateHealthDataFromDTO(UserHealthData healthData, UserHealthDataDTO dto) {
        healthData.setHeight(dto.getHeight());
        healthData.setWeight(dto.getWeight());
        healthData.setAge(dto.getAge());
        healthData.setGender(dto.getGender());
        healthData.setActivityLevel(dto.getActivityLevel());
        healthData.setDailyCalorieTarget(dto.getDailyCalorieTarget());
        healthData.setBloodSugar(dto.getBloodSugar());
        healthData.setBloodPressureHigh(dto.getBloodPressureHigh());
        healthData.setBloodPressureLow(dto.getBloodPressureLow());
        healthData.setCholesterolLevel(dto.getCholesterolLevel());
        healthData.setHeartRate(dto.getHeartRate());
        healthData.setSleepHoursPerDay(dto.getSleepHoursPerDay());
        healthData.setBodyFatPercentage(dto.getBodyFatPercentage());
        healthData.setWaistCircumference(dto.getWaistCircumference());
        healthData.setHipCircumference(dto.getHipCircumference());
        healthData.setWhr(dto.getWhr());
    }

}
