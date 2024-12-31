package com.foodrecord.controller.admin;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.entity.Post;
import com.foodrecord.model.vo.PostSearchVO;
import com.foodrecord.service.PostService;
import com.foodrecord.service.PostSearchService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/posts")
@Api(tags = "管理员帖子管理模块")
@RequireRole("ADMIN")
public class AdminPostController {

    @Resource
    private PostService postService;

    @Resource
    private PostSearchService postSearchService;

    @GetMapping("/list")
    @ApiOperation("获取所有帖子列表")
    public ApiResponse<Page<Post>> getAllPosts(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String sortBy) {
        return ApiResponse.success(postService.getPosts(pageNum, pageSize, sortBy));
    }

    @DeleteMapping("/batch")
    @ApiOperation("批量删除帖子")
    public ApiResponse<Void> batchDeletePosts(@RequestBody List<Long> postIds) {
        postIds.forEach(postService::adminDeletePost);
        return ApiResponse.success(null);
    }

    @PostMapping("/batch/pin")
    @ApiOperation("批量置顶帖子")
    public ApiResponse<Void> batchPinPosts(@RequestBody List<Long> postIds) {
        postIds.forEach(postService::pinPost);
        return ApiResponse.success(null);
    }

    @DeleteMapping("/batch/pin")
    @ApiOperation("批量取消置顶帖子")
    public ApiResponse<Void> batchUnpinPosts(@RequestBody List<Long> postIds) {
        postIds.forEach(postService::unpinPost);
        return ApiResponse.success(null);
    }

    @GetMapping("/reports")
    @ApiOperation("获取帖子举报列表")
    public ApiResponse<Page<Map<String, Object>>> getPostReports(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.getPostReports(pageNum, pageSize));
    }

    @PostMapping("/reports/{reportId}/handle")
    @ApiOperation("处理帖子举报")
    public ApiResponse<Boolean> handlePostReport(
            @PathVariable Long reportId,
            @RequestParam String action,
            @RequestParam(required = false) String feedback) {
        return ApiResponse.success(postService.handlePostReport(reportId, action, feedback));
    }

    @GetMapping("/statistics/overview")
    @ApiOperation("获取帖子总体统计信息")
    public ApiResponse<Map<String, Object>> getPostsOverview() {
        return ApiResponse.success(postService.getPostsOverview());
    }

    @GetMapping("/statistics/daily")
    @ApiOperation("获取每日帖子统计")
    public ApiResponse<List<Map<String, Object>>> getDailyPostStatistics(
            @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.success(postService.getDailyPostStatistics(days));
    }

    @GetMapping("/statistics/user-ranking")
    @ApiOperation("获取用户发帖排行")
    public ApiResponse<List<Map<String, Object>>> getUserPostRanking(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postService.getUserPostRanking(limit));
    }

    @GetMapping("/es/content-audit")
    @ApiOperation("内容审核")
    public ApiResponse<List<Map<String, Object>>> auditContent(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getContentQualityList(limit));
    }

    @GetMapping("/es/sensitive-words")
    @ApiOperation("敏感词检测")
    public ApiResponse<List<Map<String, Object>>> detectSensitiveWords(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getSensitiveWordsList(limit));
    }

    @GetMapping("/es/user-behavior")
    @ApiOperation("用户行为分析")
    public ApiResponse<Map<String, Object>> analyzeUserBehavior(
            @RequestParam Long userId,
            @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.success(postSearchService.getUserBehaviorAnalysis(userId, days));
    }

    @GetMapping("/es/content-trends")
    @ApiOperation("内容趋势分析")
    public ApiResponse<List<Map<String, Object>>> analyzeContentTrends(
            @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.success(postSearchService.getContentTrendsAnalysis(days));
    }

    @PostMapping("/es/sync-all")
    @ApiOperation("同步所有数据到ES")
    public ApiResponse<Void> syncAllDataToES() {
        List<Post> posts = postService.getList();
        postSearchService.syncBatchToES(posts);
        return ApiResponse.success(null);
    }

    @PostMapping("/es/rebuild-index")
    @ApiOperation("重建ES索引")
    public ApiResponse<Void> rebuildESIndex() {
        postSearchService.rebuildIndex();
        return ApiResponse.success(null);
    }

    @PostMapping("/batch/recommend")
    @ApiOperation("批量推荐帖子")
    public ApiResponse<Void> batchRecommendPosts(
            @RequestBody List<Long> postIds,
            @RequestParam(defaultValue = "7") int days) {
        postIds.forEach(postId -> postService.recommendPost(postId, days));
        return ApiResponse.success(null);
    }

    @GetMapping("/category/statistics")
    @ApiOperation("获取分类统计信息")
    public ApiResponse<List<Map<String, Object>>> getCategoryStatistics() {
        return ApiResponse.success(postService.getCategoryStatistics());
    }

    @GetMapping("/hot/analysis")
    @ApiOperation("获取热门帖子分析")
    public ApiResponse<List<Map<String, Object>>> getHotPostsAnalysis(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postService.getHotPostsAnalysis(days, limit));
    }

    @GetMapping("/interaction/analysis")
    @ApiOperation("获取帖子互动分析")
    public ApiResponse<Map<String, Object>> getInteractionAnalysis(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(postService.getInteractionAnalysis(days));
    }

    @PostMapping("/batch/highlight")
    @ApiOperation("批量设置精选帖子")
    public ApiResponse<Void> batchHighlightPosts(
            @RequestBody List<Long> postIds) {
        postIds.forEach(postService::highlightPost);
        return ApiResponse.success(null);
    }

    @DeleteMapping("/batch/highlight")
    @ApiOperation("批量取消精选帖子")
    public ApiResponse<Void> batchUnhighlightPosts(
            @RequestBody List<Long> postIds) {
        postIds.forEach(postService::unhighlightPost);
        return ApiResponse.success(null);
    }

    @GetMapping("/audit/list")
    @ApiOperation("获取待审核帖子列表")
    public ApiResponse<Page<Post>> getAuditPosts(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.getAuditPosts(pageNum, pageSize));
    }

    @PostMapping("/{postId}/audit")
    @ApiOperation("审核帖子")
    public ApiResponse<Boolean> auditPost(
            @PathVariable Long postId,
            @RequestParam String action,
            @RequestParam(required = false) String reason) {
        return ApiResponse.success(postService.auditPost(postId, action, reason));
    }

    @GetMapping("/es/keyword-analysis")
    @ApiOperation("关键词分析")
    public ApiResponse<List<Map<String, Object>>> getKeywordAnalysis(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.success(postSearchService.getKeywordAnalysis(days, limit));
    }

    @GetMapping("/es/quality-distribution")
    @ApiOperation("内容质量分布")
    public ApiResponse<Map<String, Object>> getQualityDistribution() {
        return ApiResponse.success(postSearchService.getQualityDistribution());
    }

    @PostMapping("/batch/move-category")
    @ApiOperation("批量移动帖子分类")
    public ApiResponse<Void> batchMoveCategory(
            @RequestBody List<Long> postIds,
            @RequestParam String targetCategory) {
        postIds.forEach(postId -> postService.moveCategory(postId, targetCategory));
        return ApiResponse.success(null);
    }
} 