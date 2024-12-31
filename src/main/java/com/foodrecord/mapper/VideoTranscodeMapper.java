package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import com.foodrecord.model.entity.video.VideoTranscodeTask;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VideoTranscodeMapper extends BaseMapper<VideoTranscodeTask> {
    
    List<VideoTranscodeTask> selectByVideoId(@Param("videoId") Long videoId);

    VideoTranscodeTask selectByTaskId(@Param("taskId") String taskId);
    
    int updateStatus(@Param("taskId") String taskId, @Param("status") Integer status);
} 