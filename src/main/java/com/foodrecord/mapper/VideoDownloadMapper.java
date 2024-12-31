package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoDownload;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoDownloadMapper extends BaseMapper<VideoDownload> {
    
    VideoDownload selectByVideoAndUser(@Param("videoId") Long videoId,
                                     @Param("userId") Long userId,
                                     @Param("quality") String quality);
    
    List<Map<String, Object>> selectByUserId(@Param("userId") Long userId,
                                            @Param("offset") int offset,
                                            @Param("pageSize") int pageSize);
    
    Map<String, Object> selectDownloadStats(@Param("videoId") Long videoId);
    
    int updateStatus(@Param("downloadId") Long downloadId,
                    @Param("status") Integer status);
} 