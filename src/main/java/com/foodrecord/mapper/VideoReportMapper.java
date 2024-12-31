package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoReport;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoReportMapper extends BaseMapper<VideoReport> {
    
    /**
     * 查询视频的举报记录(分页)
     */
    List<Map<String, Object>> selectByVideoId(@Param("videoId") Long videoId,
                                             @Param("offset") int offset,
                                             @Param("pageSize") int pageSize);
    
    /**
     * 查询用户的举报记录(分页)
     */
    List<Map<String, Object>> selectByUserId(@Param("userId") Long userId,
                                            @Param("offset") int offset,
                                            @Param("pageSize") int pageSize);
} 