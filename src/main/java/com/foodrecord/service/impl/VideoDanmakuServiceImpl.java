package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoDanmakuMapper;
import com.foodrecord.model.entity.video.VideoDanmaku;
import com.foodrecord.service.VideoDanmakuService;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Service
public class VideoDanmakuServiceImpl implements VideoDanmakuService {

    @Resource
    private VideoDanmakuMapper videoDanmakuMapper;

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String VIDEO_DANMAKU_KEY = "video:danmaku:";

    @Override
    public ApiResponse sendDanmaku(Long videoId, Long userId, String content, 
                                 Integer time, String color, Integer type, Integer fontSize) {
        try {
            VideoDanmaku danmaku = new VideoDanmaku();
            danmaku.setVideoId(videoId);
            danmaku.setUserId(userId);
            danmaku.setContent(content);
//            danmaku.setTime(time);
            danmaku.setColor(color);
//            danmaku.setType(type);
//            danmaku.setFontSize(fontSize);
//            danmaku.setStatus(0);
            danmaku.setCreatedAt(new Date());
            videoDanmakuMapper.insert(danmaku);
            
            return ApiResponse.success("发送弹幕成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "发送弹幕失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoDanmakus(Long videoId, Integer startTime, Integer endTime) {
        try {
            List<VideoDanmaku> danmakus = videoDanmakuMapper.selectByVideoTime(videoId, startTime, endTime);
            return ApiResponse.success(danmakus);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取弹幕失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse blockDanmaku(Long danmakuId) {
        try {
            videoDanmakuMapper.updateStatus(danmakuId, 1);
            return ApiResponse.success("屏蔽弹幕成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "屏蔽弹幕失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserDanmakus(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> danmakus = videoDanmakuMapper.selectByUserId(userId, offset, pageSize);
            return ApiResponse.success(danmakus);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取用户弹幕失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse deleteDanmaku(Long danmakuId, Long userId) {
        try {
            VideoDanmaku danmaku = videoDanmakuMapper.selectById(danmakuId);
            if (danmaku == null) {
                return ApiResponse.error(300, "弹幕不存在");
            }
            if (!danmaku.getUserId().equals(userId)) {
                return ApiResponse.error(300, "无权删除该弹幕");
            }
            videoDanmakuMapper.deleteById(danmakuId);
            return ApiResponse.success("��除弹幕成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "删除弹幕失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoDanmaku(Long videoId, Integer startTime, Integer endTime) {
        try {
            // 1. 构建缓存key
            String cacheKey = VIDEO_DANMAKU_KEY + videoId + ":" + startTime + ":" + endTime;
            List<Map<String, Object>> danmakus = (List<Map<String, Object>>) redisTemplate.opsForValue().get(cacheKey);
            
            if (danmakus == null) {
                // 2. 从数据库获取弹幕
                danmakus = videoDanmakuMapper.selectByTimeRange(videoId, startTime, endTime);
                if (danmakus != null) {
                    // 3. 写入缓存，设置30秒过期
                    redisTemplate.opsForValue().set(cacheKey, danmakus, 30, TimeUnit.SECONDS);
                }
            }
            
            return ApiResponse.success(danmakus);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取弹幕失败：" + e.getMessage());
        }
    }
} 