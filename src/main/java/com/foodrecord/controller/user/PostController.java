package com.foodrecord.controller.user;


import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.AuthContext;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.dto.CommentDTO;
import com.foodrecord.model.dto.PostDTO;
import com.foodrecord.model.entity.Comment;
import com.foodrecord.model.entity.Post;
import com.foodrecord.model.vo.PostSearchVO;
import com.foodrecord.service.CommentService;
import com.foodrecord.service.PostService;
import com.foodrecord.service.PostSearchService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

@RestController
@RequestMapping("/api/posts")
@Api(tags = "帖子模块")
public class PostController {

    @Resource
    private PostService postService;

    @Resource
    private CommentService commentService;

    @Resource
    private PostSearchService postSearchService;

    @GetMapping
    @ApiOperation("获取帖子列表")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getPosts(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String sortBy) {
        return ApiResponse.success(postService.getPosts(pageNum, pageSize, sortBy));
    }

    @GetMapping("/{postId}")
    @ApiOperation("获取帖子详情")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Post> getPostDetail(@PathVariable Long postId) {
        return ApiResponse.success(postService.getPostDetail(postId));
    }

    @PostMapping
    @ApiOperation("创建帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Post> createPost(@RequestBody PostDTO postDTO) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.createPost(userId, postDTO));
    }

    @PutMapping("/{postId}")
    @ApiOperation("更新帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Post> updatePost(
            @PathVariable Long postId,
            @RequestBody PostDTO postDTO) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.updatePost(userId, postId, postDTO));
    }

    @DeleteMapping("/{postId}")
    @ApiOperation("删除帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Void> deletePost(@PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        postService.deletePost(userId, postId);
        return ApiResponse.success(null);
    }

    @PostMapping("/{postId}/like")
    @ApiOperation("点赞帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> likePost(@PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.likePost(userId, postId));
    }

    @DeleteMapping("/{postId}/like")
    @ApiOperation("取消点赞")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> unlikePost(@PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.unlikePost(userId, postId));
    }

    @GetMapping("/{postId}/comments")
    @ApiOperation("获取帖子评论")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Comment>> getComments(
            @PathVariable Long postId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(commentService.getPostComments(postId, pageNum, pageSize));
    }

    @PostMapping("/{postId}/comments")
    @ApiOperation("发表评论")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Comment> createComment(
            @PathVariable Long postId,
            @RequestBody CommentDTO commentDTO) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(commentService.createComment(userId, postId, commentDTO));
    }

    @GetMapping("/user/{userId}")
    @ApiOperation("获取用户的帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getUserPosts(
            @PathVariable Long userId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.getUserPosts(userId, pageNum, pageSize));
    }

    @GetMapping("/trending")
    @ApiOperation("获取热门帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Post>> getTrendingPosts(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postService.getTrendingPosts(limit));
    }

    @GetMapping("/search")
    @ApiOperation("搜索帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> searchPosts(
            @RequestParam String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.searchPosts(keyword, pageNum, pageSize));
    }

    @GetMapping("/tags/{tag}")
    @ApiOperation("根据标签获取帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getPostsByTag(
            @PathVariable String tag,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.getPostsByTag(tag, pageNum, pageSize));
    }

    @GetMapping("/popular/tags")
    @ApiOperation("获取热门标签")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<String>> getPopularTags(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postService.getPopularTags(limit));
    }

    @PostMapping("/{postId}/favorite")
    @ApiOperation("收藏帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> favoritePost(@PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.favoritePost(userId, postId));
    }

    @DeleteMapping("/{postId}/favorite")
    @ApiOperation("取消收藏帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> unfavoritePost(@PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.unfavoritePost(userId, postId));
    }

    @GetMapping("/favorites")
    @ApiOperation("获取用户收藏的帖子列表")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getFavoritePosts(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.getFavoritePosts(userId, pageNum, pageSize));
    }

    @PostMapping("/{postId}/report")
    @ApiOperation("举报帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> reportPost(
            @PathVariable Long postId,
            @RequestParam String reason) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.reportPost(userId, postId, reason));
    }

    @GetMapping("/statistics/{userId}")
    @ApiOperation("获取用户的帖子统计信息")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getUserPostStatistics(@PathVariable Long userId) {
        return ApiResponse.success(postService.getUserPostStatistics(userId));
    }

    @PostMapping("/{postId}/pin")
    @ApiOperation("置顶帖子")
    @RequireRole({"ADMIN"})
    public ApiResponse<Boolean> pinPost(@PathVariable Long postId) {
        return ApiResponse.success(postService.pinPost(postId));
    }

    @DeleteMapping("/{postId}/pin")
    @ApiOperation("取消置顶帖子")
    @RequireRole({"ADMIN"})
    public ApiResponse<Boolean> unpinPost(@PathVariable Long postId) {
        return ApiResponse.success(postService.unpinPost(postId));
    }

    @GetMapping("/es/search")
    @ApiOperation("ES搜索帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> searchByES(
            @RequestParam String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        Long userId = AuthContext.getCurrentUser().getId();
        postSearchService.saveSearchHistory(userId, keyword);
        return ApiResponse.success(postSearchService.search(keyword, new Page<>(pageNum, pageSize)));
    }

    @PostMapping("/es/advanced-search")
    @ApiOperation("高级搜索帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> advancedSearch(
            @RequestBody PostSearchVO searchVO,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postSearchService.advancedSearch(searchVO, new Page<>(pageNum, pageSize)));
    }

    @GetMapping("/es/search/time-range")
    @ApiOperation("按时间范围搜索帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> searchByTimeRange(
            @RequestParam LocalDateTime startTime,
            @RequestParam LocalDateTime endTime,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postSearchService.searchByTimeRange(startTime, endTime, new Page<>(pageNum, pageSize)));
    }

    @GetMapping("/es/similar/{postId}")
    @ApiOperation("获取相似帖子推荐")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Post>> getSimilarPosts(
            @PathVariable Long postId,
            @RequestParam(defaultValue = "5") int limit) {
        return ApiResponse.success(postSearchService.getSimilarPosts(postId, limit));
    }

    @GetMapping("/es/hot-searches")
    @ApiOperation("获取热门搜索词")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getHotSearchWords(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getHotSearchWords(limit));
    }

    @GetMapping("/es/search-history")
    @ApiOperation("获取用户搜索历史")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<String>> getSearchHistory(
            @RequestParam(defaultValue = "10") int limit) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postSearchService.getUserSearchHistory(userId, limit));
    }

    @GetMapping("/es/tags/aggregate")
    @ApiOperation("获取标签统计信息")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Long>> aggregateByTags() {
        return ApiResponse.success(postSearchService.aggregateByTags());
    }

    @GetMapping("/es/suggest")
    @ApiOperation("获取搜索建议")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<String>> suggest(@RequestParam String prefix) {
        return ApiResponse.success(postSearchService.suggest(prefix));
    }

    @PostMapping("/es/sync")
    @ApiOperation("同步帖子到ES")
    @RequireRole({"ADMIN"})
    public ApiResponse<Void> syncToES(@RequestParam(required = false) Long postId) {
        if (postId != null) {
            Post post = postService.getPostById(postId);
            if (post != null) {
                postSearchService.syncToES(post);
            }
        } else {
            List<Post> posts = postService.getList();
            postSearchService.syncBatchToES(posts);
        }
        return ApiResponse.success(null);
    }

    @GetMapping("/es/hot-topics")
    @ApiOperation("获取热门话题")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getHotTopics(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getHotTopics(days, limit));
    }

    @GetMapping("/es/recommendations")
    @ApiOperation("获取个性化推荐帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Post>> getPersonalizedRecommendations(
            @RequestParam(defaultValue = "10") int limit) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postSearchService.getPersonalizedRecommendations(userId, limit));
    }

    @GetMapping("/es/hot-locations")
    @ApiOperation("获取热门地点")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getHotLocations(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getHotLocations(limit));
    }

    @GetMapping("/es/sentiment/{postId}")
    @ApiOperation("获取帖子情感分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> analyzeSentiment(
            @PathVariable Long postId) {
        return ApiResponse.success(postSearchService.analyzeSentiment(postId));
    }

    @GetMapping("/es/trends")
    @ApiOperation("获取趋势分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getTrends(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(postSearchService.getTrends(days));
    }

    @GetMapping("/es/similar-users/{userId}")
    @ApiOperation("获取相似用户推荐")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getSimilarUsers(
            @PathVariable Long userId,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getSimilarUsers(userId, limit));
    }

    @GetMapping("/es/hot-time-distribution")
    @ApiOperation("获取热门发帖时段分布")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Long>> getHotTimeDistribution(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(postSearchService.getHotTimeDistribution(days));
    }

    @GetMapping("/es/tag-relations/{tagName}")
    @ApiOperation("获取标签关联分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getTagRelations(
            @PathVariable String tagName,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getTagRelations(tagName, limit));
    }

    @GetMapping("/es/content-quality/{postId}")
    @ApiOperation("获取帖子内容质量评分")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getContentQualityScore(
            @PathVariable Long postId) {
        return ApiResponse.success(postSearchService.getContentQualityScore(postId));
    }
}