package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoLive;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoLiveMapper extends BaseMapper<VideoLive> {
    
    /**
     * 根据状态查询直播列表
     */
    List<Map<String, Object>> selectLiveList(@Param("status") Integer status,
                                            @Param("offset") int offset,
                                            @Param("pageSize") int pageSize);
    
    /**
     * 查询用户的直播列表
     */
    List<Map<String, Object>> selectByUserId(@Param("userId") Long userId,
                                            @Param("offset") int offset,
                                            @Param("pageSize") int pageSize);
    
    /**
     * 统计直播总数
     */
    int countLives();
    
    /**
     * 根据流ID查询直播信息
     */
    Map<String, Object> selectLiveInfo(@Param("streamId") String streamId);
    
    /**
     * 根据流ID查询直播记录
     */
    VideoLive selectByStreamId(@Param("streamId") String streamId);
} 