package com.foodrecord.controller.admin;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.entity.Comment;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.service.CommentService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/comments")
@Api(tags = "管理员评论管理模块")
@RequireRole("ADMIN")
public class AdminCommentController {

    @Resource
    private CommentService commentService;

    @GetMapping("/list")
    @ApiOperation("获取所有评论列表")
    public ApiResponse<Page<Comment>> getAllComments(
            @ApiParam(value = "页码，从1开始", example = "1")
            @RequestParam(defaultValue = "1") int page,

            @ApiParam(value = "每页记录数，默认10", example = "10")
            @RequestParam(defaultValue = "10") int size,

            @ApiParam(value = "关键字搜索反馈内容", example = "问题反馈")
            @RequestParam(value = "keyword", required = false) String keyword) {
        Page<Comment> userFeedbackPage = commentService.getComments(new Page<>(page, size), keyword);
        return ApiResponse.success(userFeedbackPage);
    }

    @DeleteMapping("/batch")
    @ApiOperation("批量删除评论")
    public ApiResponse<Void> batchDeleteComments(@RequestBody List<Long> commentIds) {
        commentIds.forEach(commentService::adminDeleteComment);
        return ApiResponse.success(null);
    }

    @GetMapping("/reports")
    @ApiOperation("获取评论举报列表")
    public ApiResponse<Page<Map<String, Object>>> getCommentReports(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(commentService.getCommentReports(pageNum, pageSize));
    }

    @PostMapping("/reports/{reportId}/handle")
    @ApiOperation("处理评论举报")
    public ApiResponse<Boolean> handleCommentReport(
            @PathVariable Long reportId,
            @RequestParam String action,
            @RequestParam(required = false) String feedback) {
        return ApiResponse.success(commentService.handleCommentReport(reportId, action, feedback));
    }

    @GetMapping("/statistics/overview")
    @ApiOperation("获取评论总体统计信息")
    public ApiResponse<Map<String, Object>> getCommentsOverview() {
        return ApiResponse.success(commentService.getCommentsOverview());
    }

    @GetMapping("/statistics/daily")
    @ApiOperation("获取每日评论统计")
    public ApiResponse<List<Map<String, Object>>> getDailyCommentStatistics(
            @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.success(commentService.getDailyCommentStatistics(days));
    }

    @GetMapping("/statistics/user-ranking")
    @ApiOperation("获取用户评论排行")
    public ApiResponse<List<Map<String, Object>>> getUserCommentRanking(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(commentService.getUserCommentRanking(limit));
    }

    @GetMapping("/sensitive")
    @ApiOperation("获取包含敏感词的评论")
    public ApiResponse<Page<Comment>> getSensitiveComments(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(commentService.getSensitiveComments(pageNum, pageSize));
    }

    @PostMapping("/batch/hide")
    @ApiOperation("批量隐藏评论")
    public ApiResponse<Void> batchHideComments(@RequestBody List<Long> commentIds) {
        commentIds.forEach(commentService::hideComment);
        return ApiResponse.success(null);
    }

    @PostMapping("/batch/show")
    @ApiOperation("批量显示评论")
    public ApiResponse<Void> batchShowComments(@RequestBody List<Long> commentIds) {
        commentIds.forEach(commentService::showComment);
        return ApiResponse.success(null);
    }

    @GetMapping("/audit/list")
    @ApiOperation("获取待审核评论列表")
    public ApiResponse<Page<Comment>> getAuditComments(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(commentService.getAuditComments(pageNum, pageSize));
    }

    @PostMapping("/{commentId}/audit")
    @ApiOperation("审核评论")
    public ApiResponse<Boolean> auditComment(
            @PathVariable Long commentId,
            @RequestParam String action,
            @RequestParam(required = false) String reason) {
        return ApiResponse.success(commentService.auditComment(commentId, action, reason));
    }

    @GetMapping("/interaction/analysis")
    @ApiOperation("获取评论互动分析")
    public ApiResponse<Map<String, Object>> getInteractionAnalysis(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(commentService.getInteractionAnalysis(days));
    }

    @GetMapping("/quality/analysis")
    @ApiOperation("获取评论质量分析")
    public ApiResponse<Map<String, Object>> getQualityAnalysis() {
        return ApiResponse.success(commentService.getQualityAnalysis());
    }

    @GetMapping("/user/behavior")
    @ApiOperation("获取用户评论行为分析")
    public ApiResponse<List<Map<String, Object>>> getUserBehaviorAnalysis(
            @RequestParam(defaultValue = "30") int days,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(commentService.getUserBehaviorAnalysis(days, limit));
    }

    @GetMapping("/keyword/analysis")
    @ApiOperation("获取评论关键词分析")
    public ApiResponse<List<Map<String, Object>>> getKeywordAnalysis(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.success(commentService.getKeywordAnalysis(days, limit));
    }

    @PostMapping("/batch/highlight")
    @ApiOperation("批量设置精选评论")
    public ApiResponse<Void> batchHighlightComments(
            @RequestBody List<Long> commentIds) {
        commentIds.forEach(commentService::highlightComment);
        return ApiResponse.success(null);
    }

    @DeleteMapping("/batch/highlight")
    @ApiOperation("批量取消精选评论")
    public ApiResponse<Void> batchUnhighlightComments(
            @RequestBody List<Long> commentIds) {
        commentIds.forEach(commentService::unhighlightComment);
        return ApiResponse.success(null);
    }

    @GetMapping("/sentiment/analysis")
    @ApiOperation("获取评论情感分析")
    public ApiResponse<Map<String, Object>> getSentimentAnalysis(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(commentService.getSentimentAnalysis(days));
    }

    @GetMapping("/time/distribution")
    @ApiOperation("获取评论时间分布")
    public ApiResponse<Map<String, Object>> getTimeDistribution(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(commentService.getTimeDistribution(days));
    }

    @GetMapping("/violation/statistics")
    @ApiOperation("获取评论违规统计")
    public ApiResponse<Map<String, Object>> getViolationStatistics(
            @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.success(commentService.getViolationStatistics(days));
    }

    @PostMapping("/batch/warn")
    @ApiOperation("批量发送警告")
    public ApiResponse<Void> batchWarnUsers(
            @RequestBody List<Long> commentIds,
            @RequestParam String warningMessage) {
        commentIds.forEach(commentId -> commentService.warnUser(commentId, warningMessage));
        return ApiResponse.success(null);
    }
} 