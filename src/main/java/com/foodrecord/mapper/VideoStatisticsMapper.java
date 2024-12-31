package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoPlayRecord;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Date;
import java.util.List;
import java.util.Map;

@Mapper
public interface VideoStatisticsMapper extends BaseMapper<VideoPlayRecord> {
    
    /**
     * 插入播放记录
     */
    int insertPlayRecord(VideoPlayRecord record);
    
    /**
     * 查询视频留存率数据
     */
    List<Map<String, Object>> selectVideoRetention(@Param("videoId") Long videoId);
    
    /**
     * 查询视频分析数据
     */
    Map<String, Object> selectVideoAnalytics(@Param("videoId") Long videoId,
                                           @Param("startDate") Date startDate,
                                           @Param("endDate") Date endDate);
    
    /**
     * 查询用户分析数据
     */
    Map<String, Object> selectUserAnalytics(@Param("userId") Long userId,
                                          @Param("startDate") Date startDate,
                                          @Param("endDate") Date endDate);
    
    /**
     * 查询视频统计数据
     */
    Map<String, Object> selectVideoStats(@Param("videoId") Long videoId);
    
    /**
     * 查询用户视频统计数据
     */
    List<Map<String, Object>> selectUserVideoStats(@Param("userId") Long userId);
    
    /**
     * 增加播放次数
     */
    int incrementPlayCount(@Param("videoId") Long videoId);
    
    /**
     * 查询热门视频
     */
    List<Map<String, Object>> selectHotVideos(@Param("offset") int offset, 
                                             @Param("pageSize") int pageSize);
} 