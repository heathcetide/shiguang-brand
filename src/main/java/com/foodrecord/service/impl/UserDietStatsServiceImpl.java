package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserDietStatsMapper;
import com.foodrecord.model.entity.UserDietStats;
import com.foodrecord.service.UserDietStatsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.time.LocalDate;
import java.util.List;

@Service
public class UserDietStatsServiceImpl extends ServiceImpl<UserDietStatsMapper, UserDietStats> implements UserDietStatsService {
    @Resource
    private UserDietStatsMapper statsMapper;
    @Resource
    private RedisUtils redisUtils;
    
    private static final String STATS_CACHE_KEY = "diet_stats:";
    private static final long CACHE_TIME = 3600; // 1小时

    public UserDietStats getByUserIdAndDate(Long userId, LocalDate date) {
        String key = STATS_CACHE_KEY + userId + ":" + date;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (UserDietStats) cached;
        }
        
        UserDietStats stats = statsMapper.selectByUserIdAndDate(userId, date);
        if (stats != null) {
            redisUtils.set(key, stats, CACHE_TIME);
        }
        return stats;
    }

    public List<UserDietStats> findByDateRange(Long userId, LocalDate startDate, LocalDate endDate) {
        return statsMapper.selectByDateRange(userId, startDate, endDate);
    }

    public List<UserDietStats> getByUserIdAndDateRange(Long userId, LocalDate startDate, LocalDate endDate) {
        return statsMapper.selectByUserIdAndDateRange(userId, startDate, endDate);
    }

    @Transactional
    public void calculateDailyStats(Long userId, LocalDate date) {
        statsMapper.calculateDailyStats(userId, date);
        clearStatsCache(userId, date);
    }

    public List<UserDietStats> getTopAchievers(LocalDate startDate, LocalDate endDate, Integer limit) {
        String key = STATS_CACHE_KEY + "top:" + startDate + ":" + endDate + ":" + limit;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (List<UserDietStats>) cached;
        }
        
        List<UserDietStats> topAchievers = statsMapper.selectTopAchievers(startDate, endDate, limit);
        redisUtils.set(key, topAchievers, CACHE_TIME);
        return topAchievers;
    }

    private void clearStatsCache(Long userId, LocalDate date) {
        redisUtils.delete(STATS_CACHE_KEY + userId + ":" + date);
        redisUtils.delete(STATS_CACHE_KEY + "top:*");
    }
} 