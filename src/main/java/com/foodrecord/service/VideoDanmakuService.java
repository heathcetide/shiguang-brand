package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoDanmakuService {
    
    /**
     * 发送弹幕
     */
    ApiResponse sendDanmaku(Long videoId, Long userId, String content, Integer time, 
                           String color, Integer type, Integer fontSize);
    
    /**
     * 获取视频弹幕列表
     */
    ApiResponse getVideoDanmakus(Long videoId, Integer startTime, Integer endTime);
    
    /**
     * 屏蔽弹幕
     */
    ApiResponse blockDanmaku(Long danmakuId);
    
    /**
     * 获取用户发送的弹幕列表
     */
    ApiResponse getUserDanmakus(Long userId, Integer pageNum, Integer pageSize);
    
    /**
     * 删除弹幕
     */
    ApiResponse deleteDanmaku(Long danmakuId, Long userId);

    /**
     * 获取指定时间范围的弹幕
     */
    ApiResponse getVideoDanmaku(Long videoId, Integer startTime, Integer endTime);
} 