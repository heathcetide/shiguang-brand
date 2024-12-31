package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoStatisticsMapper;
import com.foodrecord.model.entity.video.VideoPlayRecord;
import com.foodrecord.service.VideoStatisticsService;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class VideoStatisticsServiceImpl implements VideoStatisticsService {

    @Resource
    private VideoStatisticsMapper videoStatisticsMapper;
    
    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String VIDEO_PLAY_COUNT_KEY = "video:play:count:";
    private static final String VIDEO_PLAY_USER_KEY = "video:play:users:";
    private static final String VIDEO_PLAY_IP_KEY = "video:play:ips:";

    @Override
    public ApiResponse getVideoStats(Long videoId) {
        try {
            Map<String, Object> stats = videoStatisticsMapper.selectVideoStats(videoId);
            return ApiResponse.success(stats);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频统计数据失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserVideoStats(Long userId) {
        try {
            List<Map<String, Object>> stats = videoStatisticsMapper.selectUserVideoStats(userId);
            return ApiResponse.success(stats);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取用户视频统计数据失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse incrementPlayCount(Long videoId) {
        try {
            videoStatisticsMapper.incrementPlayCount(videoId);
            return ApiResponse.success("增加播放次数成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "增加播放次数失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getHotVideos(Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> videos = videoStatisticsMapper.selectHotVideos(offset, pageSize);
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取热门视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse recordPlay(Long videoId, Long userId, String clientIp) {
        try {
            String countKey = VIDEO_PLAY_COUNT_KEY + videoId;
            String userKey = VIDEO_PLAY_USER_KEY + videoId;
            String ipKey = VIDEO_PLAY_IP_KEY + videoId;
            
            // 1. 增加总播放次数
            redisTemplate.opsForValue().increment(countKey);
            
            // 2. 记录用户播放
            if (userId != null) {
                redisTemplate.opsForSet().add(userKey, userId);
            }
            
            // 3. 记录IP播放
            if (clientIp != null) {
                redisTemplate.opsForSet().add(ipKey, clientIp);
            }
            
            // 4. 异步保存到数据库
            VideoPlayRecord record = new VideoPlayRecord();
            record.setVideoId(videoId);
            record.setUserId(userId);
            record.setClientIp(clientIp);
            record.setPlayTime(new Date());
            videoStatisticsMapper.insertPlayRecord(record);
            
            return ApiResponse.success("记录播放成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "记录播放失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getStatistics(Long videoId) {
        try {
            String countKey = VIDEO_PLAY_COUNT_KEY + videoId;
            String userKey = VIDEO_PLAY_USER_KEY + videoId;
            String ipKey = VIDEO_PLAY_IP_KEY + videoId;
            
            Map<String, Object> stats = new HashMap<>();
            
            // 1. 获取总播放次数
            Long playCount = Long.valueOf(String.valueOf(redisTemplate.opsForValue().get(countKey)));
            stats.put("playCount", playCount);
            
            // 2. 获取独立用户数
            Long uniqueUsers = redisTemplate.opsForSet().size(userKey);
            stats.put("uniqueUsers", uniqueUsers);
            
            // 3. 获取独立IP数
            Long uniqueIps = redisTemplate.opsForSet().size(ipKey);
            stats.put("uniqueIps", uniqueIps);
            
            // 4. 获取点赞数、评论数等其他统计数据
            Map<String, Object> otherStats = videoStatisticsMapper.selectVideoStats(videoId);
            stats.putAll(otherStats);
            
            return ApiResponse.success(stats);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取统计数据失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoRetention(Long videoId) {
        try {
            List<Map<String, Object>> retentionData = videoStatisticsMapper.selectVideoRetention(videoId);
            return ApiResponse.success(retentionData);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频留存率失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoAnalytics(Long videoId, String startDate, String endDate) {
        try {
            // 将字符串日期转换为Date对象
            Date start = null;
            Date end = null;
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            
            if (startDate != null) {
                start = sdf.parse(startDate);
            }
            if (endDate != null) {
                end = sdf.parse(endDate);
            }

            // 如果没有指定日期范围，默认查询最近30天
            if (start == null) {
                Calendar cal = Calendar.getInstance();
                end = cal.getTime();
                cal.add(Calendar.DATE, -30);
                start = cal.getTime();
            }
            
            Map<String, Object> analytics = videoStatisticsMapper.selectVideoAnalytics(videoId, start, end);
            return ApiResponse.success(analytics);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频分析数据失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserAnalytics(Long userId, String startDate, String endDate) {
        try {
            // 将字符串日期转换为Date对象
            Date start = null;
            Date end = null;
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            
            if (startDate != null) {
                start = sdf.parse(startDate);
            }
            if (endDate != null) {
                end = sdf.parse(endDate);
            }

            // 如果没有指定日期范围，默认查询最近30天
            if (start == null) {
                Calendar cal = Calendar.getInstance();
                end = cal.getTime();
                cal.add(Calendar.DATE, -30);
                start = cal.getTime();
            }
            
            Map<String, Object> analytics = videoStatisticsMapper.selectUserAnalytics(userId, start, end);
            return ApiResponse.success(analytics);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取用户分析数据失败：" + e.getMessage());
        }
    }
} 