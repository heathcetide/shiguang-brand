package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.CommentReportMapper;
import com.foodrecord.model.entity.CommentReport;
import com.foodrecord.service.CommentReportService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 评论举报服务实现类
 */
@Service
public class CommentReportServiceImpl extends ServiceImpl<CommentReportMapper, CommentReport>
        implements CommentReportService {

    @Resource
    private CommentReportMapper commentReportMapper;

    @Override
    @Transactional
    public boolean createReport(Long userId, Long commentId, String reason) {
        // 检查是否已举报
        if (hasReported(userId, commentId)) {
            return false;
        }

        CommentReport report = new CommentReport();
        report.setUserId(userId);
        report.setCommentId(commentId);
        report.setReason(reason);
        report.setStatus("pending");
        report.setCreatedAt(LocalDateTime.now());
        report.setUpdatedAt(LocalDateTime.now());

        return save(report);
    }

    @Override
    @Transactional
    public boolean handleReport(Long reportId, String action, String feedback, Long handlerId) {
        CommentReport report = getById(reportId);
        if (report == null) {
            return false;
        }

        report.setStatus(action);
        report.setFeedback(feedback);
        report.setHandlerId(handlerId);
        report.setHandleTime(LocalDateTime.now());
        report.setUpdatedAt(LocalDateTime.now());

        return updateById(report);
    }

    @Override
    public List<CommentReport> getUserReportHistory(Long userId) {
        return commentReportMapper.getUserReportHistory(userId);
    }

    @Override
    public List<CommentReport> getCommentReports(Long commentId) {
        return commentReportMapper.getCommentReports(commentId);
    }

    @Override
    public Long getPendingReportCount() {
        return commentReportMapper.getPendingReportCount();
    }

    @Override
    public Page<CommentReport> getReportList(int pageNum, int pageSize, String status) {
        Page<CommentReport> page = new Page<>(pageNum, pageSize);
        LambdaQueryWrapper<CommentReport> wrapper = new LambdaQueryWrapper<>();
        
        if (status != null && !status.isEmpty()) {
            wrapper.eq(CommentReport::getStatus, status);
        }
        
        wrapper.orderByDesc(CommentReport::getCreatedAt);
        return page(page, wrapper);
    }

    @Override
    public Map<String, Object> getReportStatistics(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentReportMapper.getReportStatistics(startTime);
    }

    @Override
    public List<Map<String, Object>> getUserReportRanking(int limit) {
        return commentReportMapper.getUserReportRanking(limit);
    }

    @Override
    public List<Map<String, Object>> getReportedCommentRanking(int limit) {
        return commentReportMapper.getReportedCommentRanking(limit);
    }

    @Override
    public List<Map<String, Object>> getDailyReportStatistics(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentReportMapper.getDailyReportStatistics(startTime);
    }

    @Override
    public List<Map<String, Object>> getReportReasonDistribution() {
        return commentReportMapper.getReportReasonDistribution();
    }

    @Override
    @Transactional
    public boolean batchHandleReports(List<Long> reportIds, String action, String feedback, Long handlerId) {
        LocalDateTime now = LocalDateTime.now();
        
        for (Long reportId : reportIds) {
            CommentReport report = getById(reportId);
            if (report != null && "pending".equals(report.getStatus())) {
                report.setStatus(action);
                report.setFeedback(feedback);
                report.setHandlerId(handlerId);
                report.setHandleTime(now);
                report.setUpdatedAt(now);
                updateById(report);
            }
        }
        
        return true;
    }

    @Override
    public boolean hasReported(Long userId, Long commentId) {
        LambdaQueryWrapper<CommentReport> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(CommentReport::getUserId, userId)
                .eq(CommentReport::getCommentId, commentId);
        return count(wrapper) > 0;
    }

    @Override
    public Map<String, Object> getUserReportStats(Long userId) {
        Map<String, Object> stats = new HashMap<>();
        
        LambdaQueryWrapper<CommentReport> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(CommentReport::getUserId, userId);
        
        // 总举报数
        long totalReports = count(wrapper);
        stats.put("totalReports", totalReports);
        
        // 被采纳的举报数
        wrapper.eq(CommentReport::getStatus, "accepted");
        long acceptedReports = count(wrapper);
        stats.put("acceptedReports", acceptedReports);
        
        // 采纳率
        double acceptRate = totalReports > 0 ? (double) acceptedReports / totalReports * 100 : 0;
        stats.put("acceptRate", acceptRate);
        
        return stats;
    }

    @Override
    public List<Map<String, Object>> getFrequentReporters(int days, int limit) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        
        LambdaQueryWrapper<CommentReport> wrapper = new LambdaQueryWrapper<>();
        wrapper.ge(CommentReport::getCreatedAt, startTime)
                .groupBy(CommentReport::getUserId)
                .orderByDesc(CommentReport::getUserId)
                .last("LIMIT " + limit);
                
        return listMaps(wrapper);
    }

    @Override
    public Map<String, Object> getHandleTimeAnalysis(int days) {
        Map<String, Object> analysis = new HashMap<>();
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        
        LambdaQueryWrapper<CommentReport> wrapper = new LambdaQueryWrapper<>();
        wrapper.ge(CommentReport::getCreatedAt, startTime)
                .isNotNull(CommentReport::getHandleTime);
                
        List<CommentReport> reports = list(wrapper);
        
        // 计算平均处理时间
        long totalMinutes = 0;
        int handledCount = 0;
        
        for (CommentReport report : reports) {
            if (report.getHandleTime() != null) {
                long minutes = java.time.Duration.between(report.getCreatedAt(), report.getHandleTime()).toMinutes();
                totalMinutes += minutes;
                handledCount++;
            }
        }
        
        double avgHandleTime = handledCount > 0 ? (double) totalMinutes / handledCount : 0;
        analysis.put("averageHandleTimeMinutes", avgHandleTime);
        analysis.put("handledReports", handledCount);
        
        return analysis;
    }
} 