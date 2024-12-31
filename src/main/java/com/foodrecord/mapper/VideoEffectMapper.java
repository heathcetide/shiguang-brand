package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoEffect;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VideoEffectMapper extends BaseMapper<VideoEffect> {
    
    List<VideoEffect> selectByVideoId(@Param("videoId") Long videoId);
    
    int deleteByVideoId(@Param("videoId") Long videoId);
} 