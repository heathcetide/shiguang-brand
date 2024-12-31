package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoHistoryService {
    
    /**
     * 添加观看记录
     */
    ApiResponse addHistory(Long userId, Long videoId, Integer watchDuration);
    
    /**
     * 获取用户观看历史
     */
    ApiResponse getUserHistory(Long userId, Integer pageNum, Integer pageSize);
    
    /**
     * 清除观看记录
     */
    ApiResponse clearHistory(Long userId);
    
    /**
     * 删除单条观看记录
     */
    ApiResponse deleteHistory(Long userId, Long videoId);
} 