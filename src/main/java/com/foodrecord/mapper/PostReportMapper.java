package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.PostReport;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

public interface PostReportMapper extends BaseMapper<PostReport> {
    
    /**
     * 根据帖子ID删除举报记录
     */
    int deleteByPostId(@Param("postId") Long postId);

    /**
     * 获取举报详情列表
     */
    List<Map<String, Object>> selectReportsWithDetails(@Param("page") Page<Map<String, Object>> page);

    /**
     * 统计举报总数
     */
    Long countReports();

    /**
     * 检查举报是否存在
     */
    boolean exists(@Param("postId") Long postId, @Param("userId") Long userId);
} 