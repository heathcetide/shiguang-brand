package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoSubtitle;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VideoSubtitleMapper extends BaseMapper<VideoSubtitle> {
    
    List<VideoSubtitle> selectByVideoId(@Param("videoId") Long videoId);
    
    VideoSubtitle selectByVideoIdAndLanguage(@Param("videoId") Long videoId, @Param("language") String language);
} 