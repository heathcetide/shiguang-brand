package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoDanmaku;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoDanmakuMapper extends BaseMapper<VideoDanmaku> {
    
    List<VideoDanmaku> selectByVideoTime(@Param("videoId") Long videoId,
                                        @Param("startTime") Integer startTime,
                                        @Param("endTime") Integer endTime);
    
    List<Map<String, Object>> selectByUserId(@Param("userId") Long userId,
                                            @Param("offset") int offset,
                                            @Param("pageSize") int pageSize);
    
    int updateStatus(@Param("danmakuId") Long danmakuId,
                    @Param("status") Integer status);
    
    /**
     * 查询指定时间范围内的弹幕
     * @param videoId 视频ID
     * @param startTime 开始时间(秒)
     * @param endTime 结束时间(秒)
     * @return 弹幕列表
     */
    List<Map<String, Object>> selectByTimeRange(@Param("videoId") Long videoId,
                                              @Param("startTime") Integer startTime,
                                              @Param("endTime") Integer endTime);
} 