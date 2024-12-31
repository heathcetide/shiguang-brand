package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.CommentReport;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 评论举报Mapper接口
 */
@Mapper
public interface CommentReportMapper extends BaseMapper<CommentReport> {

    /**
     * 获取用户的举报历史
     */
    List<CommentReport> getUserReportHistory(@Param("userId") Long userId);

    /**
     * 获取评论的举报列表
     */
    List<CommentReport> getCommentReports(@Param("commentId") Long commentId);

    /**
     * 获取待处理的举报数量
     */
    Long getPendingReportCount();

    /**
     * 获取举报统计信息
     */
    Map<String, Object> getReportStatistics(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取用户举报排行
     */
    List<Map<String, Object>> getUserReportRanking(@Param("limit") int limit);

    /**
     * 获取被举报评论排行
     */
    List<Map<String, Object>> getReportedCommentRanking(@Param("limit") int limit);

    /**
     * 获取每日举报统计
     */
    List<Map<String, Object>> getDailyReportStatistics(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取举报原因分布
     */
    List<Map<String, Object>> getReportReasonDistribution();
} 