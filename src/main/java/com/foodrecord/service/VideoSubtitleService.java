package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;
import org.springframework.web.multipart.MultipartFile;

public interface VideoSubtitleService {
    
    /**
     * 上传字幕文件
     */
    ApiResponse uploadSubtitle(Long videoId, String language, MultipartFile subtitleFile);
    
    /**
     * 自动生成字幕
     */
    ApiResponse generateSubtitle(Long videoId, String language);
    
    /**
     * 获取视频字幕列表
     */
    ApiResponse getSubtitleList(Long videoId);
    
    /**
     * 获取指定语言的字幕
     */
    ApiResponse getSubtitle(Long videoId, String language);
    
    /**
     * 删除字幕
     */
    ApiResponse deleteSubtitle(Long videoId, String language);
} 