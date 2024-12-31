package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoShare;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoShareMapper extends BaseMapper<VideoShare> {
    
    List<Map<String, Object>> selectByVideoId(@Param("videoId") Long videoId,
                                             @Param("offset") int offset,
                                             @Param("pageSize") int pageSize);
    
    List<Map<String, Object>> selectByUserId(@Param("userId") Long userId,
                                            @Param("offset") int offset,
                                            @Param("pageSize") int pageSize);
    
    Map<String, Object> selectShareStats(@Param("videoId") Long videoId);
} 