package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.UserDietStats;

import java.time.LocalDate;
import java.util.List;

public interface UserDietStatsService extends IService<UserDietStats> {

    UserDietStats getByUserIdAndDate(Long userId, LocalDate date);

    List<UserDietStats> getByUserIdAndDateRange(Long userId, LocalDate startDate, LocalDate endDate);

    void calculateDailyStats(Long userId, LocalDate date);

    List<UserDietStats> getTopAchievers(LocalDate startDate, LocalDate endDate, Integer limit);
}
