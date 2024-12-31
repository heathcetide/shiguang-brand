package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoAuditRecord;
import org.apache.ibatis.annotations.Mapper;

import java.util.Map;

@Mapper
public interface VideoAuditMapper extends BaseMapper<VideoAuditRecord> {
    
    Map<String, Object> selectLatestAudit(Long videoId);
} 