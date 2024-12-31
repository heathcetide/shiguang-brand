package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoAuditRecord;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoAuditRecordMapper extends BaseMapper<VideoAuditRecord> {
    
    List<VideoAuditRecord> selectByVideoId(@Param("videoId") Long videoId);
    
    VideoAuditRecord selectLatestByVideoId(@Param("videoId") Long videoId);
    
    List<VideoAuditRecord> selectPendingList(@Param("offset") int offset, @Param("pageSize") int pageSize);
    
    /**
     * 查询视频最新的审核记录
     * @param videoId 视频ID
     * @return 审核记录信息
     */
    Map<String, Object> selectLatestAudit(@Param("videoId") Long videoId);
} 
 