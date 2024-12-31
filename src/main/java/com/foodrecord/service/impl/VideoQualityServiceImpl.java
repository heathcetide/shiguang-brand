package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoQualityMapper;
import com.foodrecord.model.entity.video.VideoQuality;
import com.foodrecord.service.VideoQualityService;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Service
public class VideoQualityServiceImpl implements VideoQualityService {

    @Resource
    private VideoQualityMapper videoQualityMapper;
    
    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String VIDEO_QUALITY_KEY = "video:quality:";
    private static final String VIDEO_URL_KEY = "video:url:";

    @Override
    public ApiResponse generateQualities(Long videoId, String[] qualities) {
        try {
            for (String quality : qualities) {
                VideoQuality videoQuality = new VideoQuality();
                videoQuality.setVideoId(videoId);
                videoQuality.setQuality(quality);
                videoQuality.setStatus(0); // 待处理
                videoQuality.setCreatedAt(new Date());
                videoQualityMapper.insert(videoQuality);
                
                // TODO: 提交异步转码任务
            }
            return ApiResponse.success("提交转码任务成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "提交转码任务失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoQualities(Long videoId) {
        try {
            List<VideoQuality> qualities = videoQualityMapper.selectByVideoId(videoId);
            return ApiResponse.success(qualities);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频清晰度失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getQualityUrl(Long videoId, String quality) {
        try {
            VideoQuality videoQuality = videoQualityMapper.selectByVideoIdAndQuality(videoId, quality);
            if (videoQuality == null) {
                return ApiResponse.error(300, "该清晰度不存在");
            }
            return ApiResponse.success(videoQuality.getVideoUrl());
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频URL失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse deleteQuality(Long videoId, String quality) {
        try {
            videoQualityMapper.deleteByVideoIdAndQuality(videoId, quality);
            return ApiResponse.success("删除成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "删除失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getTranscodeProgress(Long videoId, String quality) {
        try {
            VideoQuality videoQuality = videoQualityMapper.selectByVideoIdAndQuality(videoId, quality);
            if (videoQuality == null) {
                return ApiResponse.error(300, "转码任务不存在");
            }
            return ApiResponse.success(videoQuality);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取转码进度失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getAvailableQualities(Long videoId) {
        try {
            // 1. 先从Redis缓存获取
            String cacheKey = VIDEO_QUALITY_KEY + videoId;
            List<Map<String, Object>> qualities = (List<Map<String, Object>>) redisTemplate.opsForValue().get(cacheKey);
            
            if (qualities == null) {
                // 2. 缓存未命中，从数据库查询
                qualities = videoQualityMapper.selectQualitiesByVideoId(videoId);
                if (qualities != null) {
                    // 3. 写入缓存，设置5分钟过期
                    redisTemplate.opsForValue().set(cacheKey, qualities, 5, TimeUnit.MINUTES);
                }
            }
            
            return ApiResponse.success(qualities);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频清晰度列表失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoUrl(Long videoId, String quality) {
        try {
            // 1. 构建缓存key
            String cacheKey = VIDEO_URL_KEY + videoId + ":" + quality;
            String url = (String) redisTemplate.opsForValue().get(cacheKey);
            
            if (url == null) {
                // 2. 从数据库获取URL
                Map<String, Object> videoQuality = videoQualityMapper.selectVideoUrl(videoId, quality);
                if (videoQuality == null) {
                    return ApiResponse.error(300, "未找到对应清晰度的视频");
                }
                
                url = (String) videoQuality.get("url");
                // 3. 写入缓存，设置5分钟过期
                redisTemplate.opsForValue().set(cacheKey, url, 5, TimeUnit.MINUTES);
            }
            
            return ApiResponse.success(url);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频URL失败：" + e.getMessage());
        }
    }
} 