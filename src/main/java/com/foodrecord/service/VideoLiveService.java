package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoLiveService {
    
    /**
     * 开始直播
     */
    ApiResponse startLiveStream(Long userId, String title, String description);
    
    /**
     * 结束直播
     */
    ApiResponse endLiveStream(String streamId, Long userId);
    
    /**
     * 获取直播信息
     */
    ApiResponse getLiveStreamInfo(String streamId);
    
    /**
     * 获取直播列表
     */
    ApiResponse getLiveStreams(Integer pageNum, Integer pageSize);
} 