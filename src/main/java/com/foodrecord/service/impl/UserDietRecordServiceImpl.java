package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.UserDietRecordMapper;
import com.foodrecord.mapper.UserMapper;
import com.foodrecord.model.dto.DietStats;
import com.foodrecord.model.dto.UserDietRecordDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.entity.user.UserDietRecord;
import com.foodrecord.service.UserDietRecordService;
import org.springframework.cache.annotation.CacheConfig;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Service
@CacheConfig(cacheNames = "diet")
public class UserDietRecordServiceImpl extends ServiceImpl<UserDietRecordMapper, UserDietRecord>
        implements UserDietRecordService {
    @Resource
    private UserDietRecordMapper dietRecordMapper;
    @Resource
    private UserMapper userMapper;
    @Resource
    private FoodMapper foodMapper;

    @Override
    public Page<UserDietRecord> getUserDietRecords(Long userId, Pageable pageable) {
        return dietRecordMapper.findByUserId(userId, pageable);
    }

    @Override
    public List<UserDietRecord> getUserDietRecordsByDateRange(
            Long userId, LocalDateTime startTime, LocalDateTime endTime) {
        return dietRecordMapper.findByUserIdAndMealTimeBetween(userId, startTime, endTime);
    }

    @Override
    @Transactional
    public UserDietRecord createDietRecord(Long userId, UserDietRecordDTO dietRecordDTO) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new CustomException("用户不存在");
        }

        Food food = foodMapper.selectById(dietRecordDTO.getFoodId());
        if (food == null) {
            throw new CustomException("食物不存在");
        }

        UserDietRecord dietRecord = new UserDietRecord();
        dietRecord.setUser(user);
        dietRecord.setFood(food);
        updateDietRecordFromDTO(dietRecord, dietRecordDTO);
        dietRecordMapper.insert(dietRecord);
        return dietRecord;
    }


    @Override
    @Transactional
    public UserDietRecord updateDietRecord(Long userId, Long recordId, UserDietRecordDTO dietRecordDTO) {
        UserDietRecord dietRecord = dietRecordMapper.findById(recordId)
                .orElseThrow(() -> new CustomException("饮食记录不存在"));

        if (!dietRecord.getUser().getId().equals(userId)) {
            throw new CustomException("无权修改此记录");
        }

        if (!dietRecord.getFood().getId().equals(dietRecordDTO.getFoodId())) {
            Food food = foodMapper.selectById(dietRecordDTO.getFoodId());
            if (food == null) {
                throw new CustomException("食物不存在");
            }
            dietRecord.setFood(food);
        }

        updateDietRecordFromDTO(dietRecord, dietRecordDTO);
        dietRecordMapper.insert(dietRecord);
        return dietRecord;
    }

    private void updateDietRecordFromDTO(UserDietRecord dietRecord, UserDietRecordDTO dto) {
        dietRecord.setPortionSize(dto.getPortionSize());
        dietRecord.setMealTime(dto.getMealTime());
        dietRecord.setMealType(dto.getMealType());
        dietRecord.setNotes(dto.getNotes());
    }

    @Override
    @Transactional
    public void deleteDietRecord(Long userId, Long recordId) {
        UserDietRecord dietRecord = dietRecordMapper.findById(recordId)
                .orElseThrow(() -> new CustomException("饮食记录不存在"));

        if (!dietRecord.getUser().getId().equals(userId)) {
            throw new CustomException("无权删除此记录");
        }

        dietRecordMapper.deleteById(recordId);
    }

    @Override
    public List<UserDietRecord> findByUserIdAndMealType(Long userId, String mealType) {
        return dietRecordMapper.findByUserIdAndMealType(userId, mealType);
    }

    @Override
    @Cacheable(key = "'user:' + #userId + ':date:' + #date")
    public List<UserDietRecord> getDailyRecords(Long userId, LocalDate date) {
        return dietRecordMapper.selectDailyRecords(userId, date);
    }

    @Override
    @Cacheable(key = "'user:' + #userId + ':stats:' + #startDate + '-' + #endDate")
    public DietStats getStatistics(Long userId, LocalDate startDate, LocalDate endDate) {
        return calculateDietStats(userId, startDate, endDate);
    }

    @Override
    @CacheEvict(key = "'user:' + #record.userId + ':date:' + #record.mealTime.toLocalDate()")
    public void addRecord(UserDietRecord record) {
        dietRecordMapper.insert(record);
    }

    @Override
    public List<UserDietRecord> findByDateRange(Long userId, LocalDate startDate, LocalDate endDate) {
        return dietRecordMapper.selectByDateRange(userId, startDate, endDate);
    }

    private DietStats calculateDietStats(Long userId, LocalDate startDate, LocalDate endDate) {
        List<UserDietRecord> records = dietRecordMapper.findByUserIdAndMealTimeBetween(
                userId,
                startDate.atStartOfDay(),
                endDate.atTime(23, 59, 59)
        );
        DietStats stats = new DietStats();
        stats.setRecordCount(records.size());
//        for (UserDietRecord record : records) {
//            Food food = record.getFood();
//            stats.setTotalCalories(stats.getTotalCalories() + food.getCalories() * record.getPortionSize());
//            stats.setTotalProtein(stats.getTotalProtein() + food.getProtein() * record.getPortionSize());
//            stats.setTotalFat(stats.getTotalFat() + food.getFat() * record.getPortionSize());
//            stats.setTotalCarbohydrate(stats.getTotalCarbohydrate() + food.getCarbohydrate() * record.getPortionSize());
//        }
        return stats;
    }

} 