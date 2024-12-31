package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoMusic;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoMusicMapper extends BaseMapper<VideoMusic> {
    
    /**
     * 插入音乐使用记录
     */
    int insertMusicUse(@Param("videoId") Long videoId,
                       @Param("musicId") Long musicId,
                       @Param("startTime") Integer startTime,
                       @Param("duration") Integer duration,
                       @Param("volume") Float volume);
    
    /**
     * 删除音乐使用记录
     */
    int deleteMusicUse(@Param("videoId") Long videoId);
    
    /**
     * 增加音乐使用次数
     */
    int incrementUseCount(@Param("musicId") Long musicId);
    
    /**
     * 查询音乐列表
     */
    List<Map<String, Object>> selectMusicList(@Param("offset") int offset,
                                             @Param("pageSize") int pageSize,
                                             @Param("category") String category);
    
    /**
     * 统计音乐总数
     */
    int countMusic(@Param("category") String category);
    
    /**
     * 搜索音乐
     */
    List<Map<String, Object>> searchMusic(@Param("keyword") String keyword,
                                         @Param("offset") int offset,
                                         @Param("pageSize") int pageSize);
    
    /**
     * 统计搜索结果数量
     */
    int countSearchMusic(@Param("keyword") String keyword);
    
    /**
     * 获取热门音乐
     */
    List<Map<String, Object>> selectHotMusic(@Param("offset") int offset,
                                            @Param("pageSize") int pageSize);
} 