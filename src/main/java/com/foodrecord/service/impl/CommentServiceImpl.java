package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.CommentMapper;
import com.foodrecord.mapper.CommentReportMapper;
import com.foodrecord.model.dto.CommentDTO;
import com.foodrecord.model.entity.Comment;
import com.foodrecord.model.entity.CommentReport;
import com.foodrecord.service.CommentService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
* @author Lenovo
* @description 针对表【comment】的数据库操作Service实现
* @createDate 2024-12-02 21:47:52
*/
@Service
public class CommentServiceImpl extends ServiceImpl<CommentMapper, Comment>
    implements CommentService {

    @Resource
    private CommentMapper commentMapper;

    @Resource
    private CommentReportMapper commentReportMapper;

    @Override
    public Page<Comment> getAllComments(int pageNum, int pageSize) {
        Page<Comment> page = new Page<>(pageNum, pageSize);
        return page(page, new LambdaQueryWrapper<Comment>()
                .orderByDesc(Comment::getCreatedAt));
    }

    @Override
    public void adminDeleteComment(Long commentId) {
        removeById(commentId);
    }

    @Override
    public Page<Map<String, Object>> getCommentReports(int pageNum, int pageSize) {
        Page<CommentReport> page = new Page<>(pageNum, pageSize);
        Page<CommentReport> reportPage = commentReportMapper.selectPage(page,
                new LambdaQueryWrapper<CommentReport>()
                        .orderByDesc(CommentReport::getCreatedAt));

        // 转换为Map格式
        List<Map<String, Object>> records = reportPage.getRecords().stream()
                .map(report -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("reportId", report.getId());
                    map.put("commentId", report.getCommentId());
                    map.put("userId", report.getUserId());
                    map.put("reason", report.getReason());
                    map.put("status", report.getStatus());
                    map.put("createdAt", report.getCreatedAt());
                    return map;
                }).collect(Collectors.toList());

        Page<Map<String, Object>> resultPage = new Page<>(pageNum, pageSize, reportPage.getTotal());
        resultPage.setRecords(records);
        return resultPage;
    }

    @Override
    @Transactional
    public Boolean handleCommentReport(Long reportId, String action, String feedback) {
        CommentReport report = commentReportMapper.selectById(reportId);
        if (report == null) {
            return false;
        }

        // 更新举报状态
        report.setStatus(action);
        report.setFeedback(feedback);
        report.setUpdatedAt(LocalDateTime.now());
        commentReportMapper.updateById(report);

        // 如果是删除评论的操作
        if ("delete".equals(action)) {
            removeById(report.getCommentId());
        }

        return true;
    }

    @Override
    public Map<String, Object> getCommentsOverview() {
        Map<String, Object> overview = new HashMap<>();
        
        // 总评论数
        overview.put("totalComments", count());
        
        // 今日评论数
        LocalDateTime today = LocalDateTime.now().withHour(0).withMinute(0).withSecond(0);
        long todayComments = count(new LambdaQueryWrapper<Comment>()
                .ge(Comment::getCreatedAt, today));
        overview.put("todayComments", todayComments);
        
        // 待审核评论数
        long pendingAudit = count(new LambdaQueryWrapper<Comment>()
                .eq(Comment::getStatus, "pending"));
        overview.put("pendingAudit", pendingAudit);
        
        // 举报评论数
        long reportedComments = commentReportMapper.selectCount(null);
        overview.put("reportedComments", reportedComments);
        
        return overview;
    }

    @Override
    public List<Map<String, Object>> getDailyCommentStatistics(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days).withHour(0).withMinute(0).withSecond(0);
        return commentMapper.getDailyStatistics(startTime);
    }

    @Override
    public List<Map<String, Object>> getUserCommentRanking(int limit) {
        return commentMapper.getUserCommentRanking(limit);
    }

    @Override
    public Page<Comment> getSensitiveComments(int pageNum, int pageSize) {
        // 这里应该配合敏感词系统来实现
        // 暂时返回空结果
        return new Page<>(pageNum, pageSize);
    }

    @Override
    public void hideComment(Long commentId) {
        Comment comment = getById(commentId);
        if (comment != null) {
//            comment.setIsVisible(false);
            updateById(comment);
        }
    }

    @Override
    public void showComment(Long commentId) {
        Comment comment = getById(commentId);
        if (comment != null) {
//            comment.setIsVisible(true);
            updateById(comment);
        }
    }

    @Override
    public Page<Comment> getAuditComments(int pageNum, int pageSize) {
        Page<Comment> page = new Page<>(pageNum, pageSize);
        return page(page, new LambdaQueryWrapper<Comment>()
                .eq(Comment::getStatus, "pending")
                .orderByDesc(Comment::getCreatedAt));
    }

    @Override
    @Transactional
    public Boolean auditComment(Long commentId, String action, String reason) {
        Comment comment = getById(commentId);
        if (comment == null) {
            return false;
        }

//        if ("approve".equals(action)) {
//            comment.setStatus("approved");
//        } else if ("reject".equals(action)) {
//            comment.setStatus("rejected");
//            comment.setRejectReason(reason);
//        }
//
        comment.setUpdatedAt(LocalDateTime.now());
        return updateById(comment);
    }

    @Override
    public Map<String, Object> getInteractionAnalysis(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentMapper.getInteractionAnalysis(startTime);
    }

    @Override
    public Map<String, Object> getQualityAnalysis() {
        return commentMapper.getQualityAnalysis();
    }

    @Override
    public List<Map<String, Object>> getUserBehaviorAnalysis(int days, int limit) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentMapper.getUserBehaviorAnalysis(startTime, limit);
    }

    @Override
    public List<Map<String, Object>> getKeywordAnalysis(int days, int limit) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentMapper.getKeywordAnalysis(startTime, limit);
    }

    @Override
    public void highlightComment(Long commentId) {
        Comment comment = getById(commentId);
        if (comment != null) {
//            comment.setIsHighlight(true);
            updateById(comment);
        }
    }

    @Override
    public void unhighlightComment(Long commentId) {
        Comment comment = getById(commentId);
        if (comment != null) {
//            comment.setIsHighlight(false);
            updateById(comment);
        }
    }

    @Override
    public Map<String, Object> getSentimentAnalysis(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentMapper.getSentimentAnalysis(startTime);
    }

    @Override
    public Map<String, Object> getTimeDistribution(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentMapper.getTimeDistribution(startTime);
    }

    @Override
    public Map<String, Object> getViolationStatistics(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return commentMapper.getViolationStatistics(startTime);
    }

    @Override
    public void warnUser(Long commentId, String warningMessage) {
        Comment comment = getById(commentId);
        if (comment != null) {
            // 这里应该调用消息系统发送警告
            // 记录警告历史
//            comment.setWarningMessage(warningMessage);
//            comment.setWarningTime(LocalDateTime.now());
            updateById(comment);
        }
    }

    @Override
    public Page<Comment> getComments(Page<Comment> objectPage, String keyword) {
        return commentMapper.selectComments(objectPage, keyword);
    }

    @Override
    public List<Comment> getCommentList(String postId) {
        return commentMapper.getListByPostId(postId);
    }

    @Override
    public boolean insert(Comment comment) {
        return commentMapper.save(comment);
    }

    @Override
    public boolean delete(Long id) {
        return commentMapper.removeById(id);
    }

    @Override
    public Comment selectById(Long id) {
        return commentMapper.getById(id);
    }

    @Override
    public List<Comment> getList() {
        return commentMapper.getCommentList();
    }

    @Override
    public List<Comment> getCommentListBatch(String postId) {
        try {
            return commentMapper.selectBatchByPostId(postId);
        } catch (Exception e) {
            log.error("批量获取评论失败，postId: " + postId, e);
            return new ArrayList<>();
        }
    }

    @Override
    public Long getCommentCount(String postId) {
        try {
            return commentMapper.selectCommentCount(postId);
        } catch (Exception e) {
            log.error("获取评论数量失败，postId: " + postId, e);
            return 0L;
        }
    }

    @Override
    public boolean updateContent(Comment comment) {
        return commentMapper.updateComment(comment.getId(),comment.getContent());
    }

    @Override
    public Page<Comment> getPostComments(Long postId, int pageNum, int pageSize) {
        return null;
    }

    @Override
    public Comment createComment(Long userId, Long postId, CommentDTO commentDTO) {
        return null;
    }
}




