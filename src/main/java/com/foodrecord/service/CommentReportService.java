package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.CommentReport;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 评论举报服务接口
 */
public interface CommentReportService extends IService<CommentReport> {

    /**
     * 创建举报
     */
    boolean createReport(Long userId, Long commentId, String reason);

    /**
     * 处理举报
     */
    boolean handleReport(Long reportId, String action, String feedback, Long handlerId);

    /**
     * 获取用户的举报历史
     */
    List<CommentReport> getUserReportHistory(Long userId);

    /**
     * 获取评论的举报列表
     */
    List<CommentReport> getCommentReports(Long commentId);

    /**
     * 获取待处理的举报数量
     */
    Long getPendingReportCount();

    /**
     * 分页获取举报列表
     */
    Page<CommentReport> getReportList(int pageNum, int pageSize, String status);

    /**
     * 获取举报统计信息
     */
    Map<String, Object> getReportStatistics(int days);

    /**
     * 获取用户举报排行
     */
    List<Map<String, Object>> getUserReportRanking(int limit);

    /**
     * 获取被举报评论排行
     */
    List<Map<String, Object>> getReportedCommentRanking(int limit);

    /**
     * 获取每日举报统计
     */
    List<Map<String, Object>> getDailyReportStatistics(int days);

    /**
     * 获取举报原因分布
     */
    List<Map<String, Object>> getReportReasonDistribution();

    /**
     * 批量处理举报
     */
    boolean batchHandleReports(List<Long> reportIds, String action, String feedback, Long handlerId);

    /**
     * 检查用户是否已举报该评论
     */
    boolean hasReported(Long userId, Long commentId);

    /**
     * 获取用户举报统计
     */
    Map<String, Object> getUserReportStats(Long userId);

    /**
     * 获取高频举报用户
     */
    List<Map<String, Object>> getFrequentReporters(int days, int limit);

    /**
     * 获取举报处理时效分析
     */
    Map<String, Object> getHandleTimeAnalysis(int days);
} 