package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoQuality;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoQualityMapper extends BaseMapper<VideoQuality> {
    
    /**
     * 查询视频的所有清晰度(返回Map)
     */
    List<Map<String, Object>> selectQualitiesByVideoId(@Param("videoId") Long videoId);
    
    /**
     * 查询视频的所有清晰度(返回实体)
     */
    List<VideoQuality> selectByVideoId(@Param("videoId") Long videoId);
    
    /**
     * 查询指定清晰度的视频URL
     */
    Map<String, Object> selectVideoUrl(@Param("videoId") Long videoId, 
                                     @Param("quality") String quality);
    
    /**
     * 根据视频ID和清晰度查询
     */
    VideoQuality selectByVideoIdAndQuality(@Param("videoId") Long videoId, 
                                         @Param("quality") String quality);
    
    /**
     * 删除指定清晰度的视频
     */
    int deleteByVideoIdAndQuality(@Param("videoId") Long videoId,
                                @Param("quality") String quality);
} 