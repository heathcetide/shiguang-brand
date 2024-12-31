package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoStatisticsService {
    
    /**
     * 获取视频统计数据
     */
    ApiResponse getVideoStats(Long videoId);
    
    /**
     * 获取用户视频统计数据
     */
    ApiResponse getUserVideoStats(Long userId);
    
    /**
     * 增加视频播放次数
     */
    ApiResponse incrementPlayCount(Long videoId);
    
    /**
     * 获取热门视频排行
     */
    ApiResponse getHotVideos(Integer pageNum, Integer pageSize);

    /**
     * 记录视频播放
     */
    ApiResponse recordPlay(Long videoId, Long userId, String clientIp);

    /**
     * 获取视频统计信息
     */
    ApiResponse getStatistics(Long videoId);

    /**
     * 获取视频留存率
     */
    ApiResponse getVideoRetention(Long videoId);

    /**
     * 获取视频分析数据
     */
    ApiResponse getVideoAnalytics(Long videoId, String startDate, String endDate);

    /**
     * 获取用户分析数据
     */
    ApiResponse getUserAnalytics(Long userId, String startDate, String endDate);
} 