package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoWatchHistory;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoHistoryMapper extends BaseMapper<VideoWatchHistory> {

    VideoWatchHistory selectByUserAndVideo(@Param("userId") Long userId, @Param("videoId") Long videoId);
    
    List<Map<String, Object>> selectUserHistory(@Param("userId") Long userId, 
                                              @Param("offset") int offset, 
                                              @Param("pageSize") int pageSize);
    
    int deleteByUserId(@Param("userId") Long userId);
    
    int deleteByUserAndVideo(@Param("userId") Long userId, @Param("videoId") Long videoId);
} 