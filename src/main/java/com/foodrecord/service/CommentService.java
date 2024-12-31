package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.CommentDTO;
import com.foodrecord.model.entity.Comment;

import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【comment】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface CommentService extends IService<Comment> {

    List<Comment> getCommentList(String postId);

    boolean insert(Comment comment);

    boolean delete(Long id);

    Comment selectById(Long id);

    List<Comment> getList();

    /**
     * 批量获取评论列表
     * @param postId 帖子ID
     * @return 评论列表
     */
    List<Comment> getCommentListBatch(String postId);

    /**
     * 获取帖子的评论数量
     * @param postId 帖子ID
     * @return 评论数量
     */
    Long getCommentCount(String postId);

    boolean updateContent(Comment comment);

    Page<Comment> getPostComments(Long postId, int pageNum, int pageSize);

    Comment createComment(Long userId, Long postId, CommentDTO commentDTO);

    /**
     * 获取所有评论列表
     */
    Page<Comment> getAllComments(int pageNum, int pageSize);

    /**
     * 管理员删除评论
     */
    void adminDeleteComment(Long commentId);

    /**
     * 获取评论举报列表
     */
    Page<Map<String, Object>> getCommentReports(int pageNum, int pageSize);

    /**
     * 处理评论举报
     */
    Boolean handleCommentReport(Long reportId, String action, String feedback);

    /**
     * 获取评论总体统计信息
     */
    Map<String, Object> getCommentsOverview();

    /**
     * 获取每日评论统计
     */
    List<Map<String, Object>> getDailyCommentStatistics(int days);

    /**
     * 获取用户评论排行
     */
    List<Map<String, Object>> getUserCommentRanking(int limit);

    /**
     * 获取包含敏感词的评论
     */
    Page<Comment> getSensitiveComments(int pageNum, int pageSize);

    /**
     * 隐藏评论
     */
    void hideComment(Long commentId);

    /**
     * 显示评论
     */
    void showComment(Long commentId);

    /**
     * 获取待审核评论列表
     */
    Page<Comment> getAuditComments(int pageNum, int pageSize);

    /**
     * 审核评论
     */
    Boolean auditComment(Long commentId, String action, String reason);

    /**
     * 获取评论互动分析
     */
    Map<String, Object> getInteractionAnalysis(int days);

    /**
     * 获取评论质量分析
     */
    Map<String, Object> getQualityAnalysis();

    /**
     * 获取用户评论行为分析
     */
    List<Map<String, Object>> getUserBehaviorAnalysis(int days, int limit);

    /**
     * 获取评论关键词分析
     */
    List<Map<String, Object>> getKeywordAnalysis(int days, int limit);

    /**
     * 设置精选评论
     */
    void highlightComment(Long commentId);

    /**
     * 取消精选评论
     */
    void unhighlightComment(Long commentId);

    /**
     * 获取评论情感分析
     */
    Map<String, Object> getSentimentAnalysis(int days);

    /**
     * 获取评论时间分布
     */
    Map<String, Object> getTimeDistribution(int days);

    /**
     * 获取评论违规统计
     */
    Map<String, Object> getViolationStatistics(int days);

    /**
     * 发送警告给用户
     */
    void warnUser(Long commentId, String warningMessage);
}
