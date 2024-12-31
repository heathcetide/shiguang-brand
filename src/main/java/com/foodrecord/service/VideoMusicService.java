package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoMusicService {
    
    /**
     * 添加背景音乐
     */
    ApiResponse addBackgroundMusic(Long videoId, Long musicId, Integer startTime, Integer duration, Float volume);
    
    /**
     * 移除背景音乐
     */
    ApiResponse removeBackgroundMusic(Long videoId);
    
    /**
     * 获取音乐列表
     */
    ApiResponse getMusicList(Integer pageNum, Integer pageSize, String category);
    
    /**
     * 获取音乐详情
     */
    ApiResponse getMusicDetail(Long musicId);
    
    /**
     * 搜索音乐
     */
    ApiResponse searchMusic(String keyword, Integer pageNum, Integer pageSize);
    
    /**
     * 获取热门音乐
     */
    ApiResponse getHotMusic(Integer pageNum, Integer pageSize);
} 