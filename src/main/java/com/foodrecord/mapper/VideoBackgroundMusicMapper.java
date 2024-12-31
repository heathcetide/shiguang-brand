package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoBackgroundMusic;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VideoBackgroundMusicMapper extends BaseMapper<VideoBackgroundMusic> {
    
    List<VideoBackgroundMusic> selectByCategory(@Param("category") String category, 
                                              @Param("offset") int offset, 
                                              @Param("pageSize") int pageSize);
    
    int incrementUseCount(@Param("id") Long id);
} 