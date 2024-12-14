package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.DietStats;
import com.foodrecord.model.dto.UserDietRecordDTO;
import com.foodrecord.model.entity.UserDietRecord;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public interface UserDietRecordService extends IService<UserDietRecord> {
    Page<UserDietRecord> getUserDietRecords(Long userId, Pageable pageable);

    List<UserDietRecord> getUserDietRecordsByDateRange(
            Long userId, LocalDateTime startTime, LocalDateTime endTime);

    UserDietRecord createDietRecord(Long userId, UserDietRecordDTO dietRecordDTO);

    UserDietRecord updateDietRecord(Long userId, Long recordId, UserDietRecordDTO dietRecordDTO);

    void deleteDietRecord(Long userId, Long recordId);

    List<UserDietRecord> findByUserIdAndMealType(Long userId, String mealType);

    List<UserDietRecord> getDailyRecords(Long userId, LocalDate date);

    DietStats getStatistics(Long userId, LocalDate startDate, LocalDate endDate);

    void addRecord(UserDietRecord record);

    List<UserDietRecord> findByDateRange(Long userId, LocalDate startDate, LocalDate endDate);
}
