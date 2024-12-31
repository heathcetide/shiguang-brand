package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoEditRecord;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VideoEditRecordMapper extends BaseMapper<VideoEditRecord> {
    
    List<VideoEditRecord> selectByVideoId(@Param("videoId") Long videoId);
    
    List<VideoEditRecord> selectByUserId(@Param("userId") Long userId, 
                                       @Param("offset") int offset, 
                                       @Param("pageSize") int pageSize);
} 