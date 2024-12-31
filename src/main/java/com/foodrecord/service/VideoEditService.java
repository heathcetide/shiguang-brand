package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

import java.util.List;
import java.util.Map;

public interface VideoEditService {
    
    /**
     * 裁剪视频
     */
    ApiResponse trimVideo(Long videoId, Integer startTime, Integer endTime);
    
    /**
     * 合并多个视频
     */
    ApiResponse mergeVideos(List<Long> videoIds, String title, String description);
    
    /**
     * 添加视频滤镜
     */
    ApiResponse addVideoFilter(Long videoId, String filterType, Map<String, Object> filterParams);
    
    /**
     * 添加视频文字
     */
    ApiResponse addVideoText(Long videoId, String text, Integer startTime, Integer duration, Map<String, Object> textStyle);
    
    /**
     * 获取视频编辑进度
     */
    ApiResponse getEditProgress(String taskId);
} 