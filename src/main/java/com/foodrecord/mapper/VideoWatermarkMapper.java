package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoWatermark;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VideoWatermarkMapper extends BaseMapper<VideoWatermark> {
    
    List<VideoWatermark> selectByVideoId(@Param("videoId") Long videoId);
    
    int updateWatermark(@Param("watermarkId") Long watermarkId,
                       @Param("content") String content,
                       @Param("position") String position,
                       @Param("size") Integer size,
                       @Param("opacity") Float opacity);
} 