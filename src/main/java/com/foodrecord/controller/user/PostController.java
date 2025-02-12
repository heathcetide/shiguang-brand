package com.foodrecord.controller.user;


import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.AuthContext;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.model.dto.CommentDTO;
import com.foodrecord.model.dto.PostDTO;
import com.foodrecord.model.entity.Comment;
import com.foodrecord.model.entity.Post;
import com.foodrecord.model.entity.Topics;
import com.foodrecord.model.vo.PostSearchVO;
import com.foodrecord.service.*;
import com.google.common.util.concurrent.RateLimiter;
import io.swagger.annotations.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static com.foodrecord.constant.PostConstants.KEY_POST;
import static com.foodrecord.constant.PostConstants.POST_CACHE_TTL;

@RestController
@RequestMapping("/api/posts")
@Api(tags = "帖子模块")
public class PostController {

    @Resource
    private PostService postService;

    @Resource
    private CommentService commentService;

    @Resource
    private PostLikesService postLikesService;

    @Resource
    private PostSearchService postSearchService;

    @Resource
    private RedisUtils redisUtils;

    @Resource
    private IpBlockService ipBlockService;

    // 限流器配置
    private final RateLimiter rateLimiter = RateLimiter.create(20.0);

    // Guava本地缓存配置
    private final Cache<String, Post> localCache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(1000)
            .recordStats()
            .build();

    // 批量操作线程池
    private final ExecutorService executorService = Executors.newFixedThreadPool(4);

    // 批量预热线程池
    private final ExecutorService cacheWarmupExecutor = Executors.newFixedThreadPool(4);

    @Scheduled(fixedRate = 5000)
    public void adjustRateLimiter() {
        long maxMemory = Runtime.getRuntime().maxMemory();
        long usedMemory = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        double memoryUsage = (double) usedMemory / maxMemory;

        double dynamicRateLimit;
        if (memoryUsage < 0.5) {
            dynamicRateLimit = 20.0;
        } else if (memoryUsage < 0.8) {
            dynamicRateLimit = 10.0;
        } else {
            dynamicRateLimit = 5.0;
        }

        rateLimiter.setRate(dynamicRateLimit);
    }

    @PostConstruct
    public void preheatCache() {
        List<Long> hotPostIds = postService.getHotPostIds();
        hotPostIds.parallelStream().forEach(postId -> {
            cacheWarmupExecutor.submit(() -> {
                try {
                    Post post = postService.selectById(postId);
                    if (post != null) {
                        updateCacheAsync(String.valueOf(postId), post);
                    }
                } catch (Exception e) {
                    System.out.println("缓存预热失败: " + postId + e);
                }
            });
        });
    }

    private void updateCacheAsync(String id, Post post) {
        CompletableFuture.runAsync(() -> {
            try {
                String redisKey = KEY_POST + id;
                redisUtils.set(redisKey, post, POST_CACHE_TTL,TimeUnit.MINUTES);
                localCache.put(id, post);
            } catch (Exception e) {
                System.out.println("更新缓存失败: " + e.getMessage());
            }
        });
    }
    /**
     * 获取帖子列表
     *
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     * @param sortBy   排序字段（可选）
     * @return 包含帖子列表的ApiResponse对象
     */
    @GetMapping
    @ApiOperation(value = "获取帖子列表")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getPosts(
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize,
            @ApiParam(value = "排序字段") @RequestParam(required = false) String sortBy) {
        return ApiResponse.success(postService.getPosts(new Page<>(pageNum, pageSize), sortBy));
    }

    /**
     * 获取帖子详情
     *
     * @param postId 帖子ID
     * @return 包含帖子详情的ApiResponse对象
     */
    @GetMapping("/{postId}")
    @ApiOperation(value = "获取帖子详情")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Post> getPostDetail(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        return ApiResponse.success(postService.getPostDetail(postId));
    }

    /**
     * 创建帖子
     *
     * @param postDTO 帖子DTO对象
     * @return 包含创建帖子结果的ApiResponse对象
     */
    @PostMapping
    @ApiOperation(value = "创建帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Post> createPost(@ApiParam(value = "帖子DTO对象") @RequestBody PostDTO postDTO) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.createPost(userId, postDTO));
    }

    /**
     * 更新帖子
     *
     * @param postId  帖子ID
     * @param postDTO 帖子DTO对象
     * @return 包含更新帖子结果的ApiResponse对象
     */
    @PutMapping("/{postId}")
    @ApiOperation(value = "更新帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Post> updatePost(
            @ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId,
            @ApiParam(value = "帖子DTO对象") @RequestBody PostDTO postDTO) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.updatePost(userId, postId, postDTO));
    }

    /**
     * 删除帖子
     *
     * @param postId 帖子ID
     * @return 包含删除帖子结果的ApiResponse对象
     */
    @DeleteMapping("/{postId}")
    @ApiOperation(value = "删除帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Void> deletePost(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        postService.deletePost(userId, postId);
        return ApiResponse.success(null);
    }

    /**
     * 点赞帖子
     *
     * @param postId 帖子ID
     * @return 包含点赞结果的ApiResponse对象
     */
    @PostMapping("/{postId}/like")
    @ApiOperation(value = "点赞帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> likePost(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.likePost(userId, postId));
    }

    /**
     * 取消点赞
     *
     * @param postId 帖子ID
     * @return 包含取消点赞结果的ApiResponse对象
     */
    @DeleteMapping("/{postId}/like")
    @ApiOperation(value = "取消点赞")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> unlikePost(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.unlikePost(userId, postId));
    }

    /**
     * 获取帖子评论
     *
     * @param postId   帖子ID
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     * @return 包含帖子评论的ApiResponse对象
     */
    @GetMapping("/{postId}/comments")
    @ApiOperation(value = "获取帖子评论")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Comment>> getComments(
            @ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId,
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(commentService.getPostComments(postId, pageNum, pageSize));
    }

    /**
     * 发表评论
     *
     * @param postId     帖子ID
     * @param commentDTO 评论DTO对象
     * @return 包含发表评论结果的ApiResponse对象
     */
    @PostMapping("/{postId}/comments")
    @ApiOperation(value = "发表评论")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Comment> createComment(
            @ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId,
            @ApiParam(value = "评论DTO对象") @RequestBody CommentDTO commentDTO) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(commentService.createComment(userId, postId, commentDTO));
    }

    /**
     * 获取用户的帖子
     *
     * @param userId   用户ID
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     * @return 包含用户帖子列表的ApiResponse对象
     */
    @GetMapping("/user/{userId}")
    @ApiOperation(value = "获取用户的帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getUserPosts(
            @ApiParam(value = "用户ID", example = "1") @PathVariable Long userId,
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.getUserPosts(userId, pageNum, pageSize));
    }

    /**
     * 获取热门帖子
     *
     * @param limit 返回数量限制（默认10）
     * @return 包含热门帖子列表的ApiResponse对象
     */
    @GetMapping("/trending")
    @ApiOperation(value = "获取热门帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Post>> getTrendingPosts(
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postService.getTrendingPosts(limit));
    }

    /**
     * 搜索帖子
     *
     * @param keyword  关键字
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     * @return 包含搜索结果的ApiResponse对象
     */
    @GetMapping("/search")
    @ApiOperation(value = "搜索帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> searchPosts(
            @ApiParam(value = "关键字") @RequestParam String keyword,
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.searchPosts(keyword, pageNum, pageSize));
    }

    /**
     * 根据标签获取帖子
     *
     * @param tag      标签名称
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     *0 @return 包含标签帖子列表的ApiResponse对象
     */
    @GetMapping("/tags/{tag}")
    @ApiOperation(value = "根据标签获取帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getPostsByTag(
            @ApiParam(value = "标签名称", example = "美食") @PathVariable String tag,
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postService.getPostsByTag(tag, pageNum, pageSize));
    }

    /**
     * 获取热门标签
     *
     * @param limit 返回数量限制（默认10）
     * @return 包含热门标签列表的ApiResponse对象
     */
    @GetMapping("/popular/tags")
    @ApiOperation(value = "获取热门标签")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<String>> getPopularTags(
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postService.getPopularTags(limit));
    }

    /**
     * 收藏帖子
     *
     * @param postId 帖子ID
     * @return 包含收藏结果的ApiResponse对象
     */
    @PostMapping("/{postId}/favorite")
    @ApiOperation(value = "收藏帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> favoritePost(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.favoritePost(userId, postId));
    }

    /**
     * 取消收藏帖子
     *
     * @param postId 帖子ID
     * @return 包含取消收藏结果的ApiResponse对象
     */
    @DeleteMapping("/{postId}/favorite")
    @ApiOperation(value = "取消收藏帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> unfavoritePost(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.unfavoritePost(userId, postId));
    }

    /**
     * 获取用户收藏的帖子列表
     *
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     * @return 包含用户收藏帖子列表的ApiResponse对象
     */
    @GetMapping("/favorites")
    @ApiOperation(value = "获取用户收藏的帖子列表")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> getFavoritePosts(
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.getFavoritePosts(userId, pageNum, pageSize));
    }

    /**
     * 举报帖子
     *
     * @param postId 帖子ID
     * @param reason 举报原因
     * @return 包含举报结果的ApiResponse对象
     */
    @PostMapping("/{postId}/report")
    @ApiOperation(value = "举报帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> reportPost(
            @ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId,
            @ApiParam(value = "举报原因") @RequestParam String reason) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postService.reportPost(userId, postId, reason));
    }

    /**
     * 获取用户的帖子统计信息
     *
     * @param userId 用户ID
     * @return 包含用户帖子统计信息的ApiResponse对象
     */
    @GetMapping("/statistics/{userId}")
    @ApiOperation(value = "获取用户的帖子统计信息")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getUserPostStatistics(@ApiParam(value = "用户ID", example = "1") @PathVariable Long userId) {
        return ApiResponse.success(postService.getUserPostStatistics(userId));
    }

    /**
     * 置顶帖子
     *
     * @param postId 帖子ID
     * @return 包含置顶结果的ApiResponse对象
     */
    @PostMapping("/{postId}/pin")
    @ApiOperation(value = "置顶帖子")
    @RequireRole({"ADMIN"})
    public ApiResponse<Boolean> pinPost(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        return ApiResponse.success(postService.pinPost(postId));
    }

    /**
     * 取消置顶帖子
     *
     * @param postId 帖子ID
     * @return 包含取消置顶结果的ApiResponse对象
     */
    @DeleteMapping("/{postId}/pin")
    @ApiOperation(value = "取消置顶帖子")
    @RequireRole({"ADMIN"})
    public ApiResponse<Boolean> unpinPost(@ApiParam(value = "帖子ID", example = "1") @PathVariable Long postId) {
        return ApiResponse.success(postService.unpinPost(postId));
    }

    /**
     * ES搜索帖子
     *
     * @param keyword  关键字
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     * @return 包含ES搜索结果的ApiResponse对象
     */
    @GetMapping("/es/search")
    @ApiOperation(value = "ES搜索帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> searchByES(
            @ApiParam(value = "关键字") @RequestParam String keyword,
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize) {
        Long userId = AuthContext.getCurrentUser().getId();
        postSearchService.saveSearchHistory(userId, keyword);
        return ApiResponse.success(postSearchService.search(keyword, new Page<>(pageNum, pageSize)));
    }

    /**
     * 高级搜索帖子
     *
     * @param searchVO 搜索条件对象
     * @param pageNum  页码（默认1）
     * @param pageSize 每页数量（默认10）
     * @return 包含高级搜索结果的ApiResponse对象
     */
    @PostMapping("/es/advanced-search")
    @ApiOperation(value = "高级搜索帖子")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> advancedSearch(
            @ApiParam(value = "搜索条件对象") @RequestBody PostSearchVO searchVO,
            @ApiParam(value = "页码", example = "1", defaultValue = "1") @RequestParam(defaultValue = "1") int pageNum,
            @ApiParam(value = "每页数量", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postSearchService.advancedSearch(searchVO, new Page<>(pageNum, pageSize)));
    }

    /**
     * 按时间范围搜索帖子
     *
     * @param startTime 起始时间
     * @param endTime 结束时间
     * @param pageNum 页码，默认为1
     * @param pageSize 每页大小，默认为10
     * @return 包含帖子分页结果的ApiResponse对象
     */
    @GetMapping("/es/search/time-range")
    @ApiOperation("按时间范围搜索帖子")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "startTime", value = "起始时间", required = true, dataType = "LocalDateTime", paramType = "query"),
            @ApiImplicitParam(name = "endTime", value = "结束时间", required = true, dataType = "LocalDateTime", paramType = "query"),
            @ApiImplicitParam(name = "pageNum", value = "页码", defaultValue = "1", dataType = "int", paramType = "query"),
            @ApiImplicitParam(name = "pageSize", value = "每页大小", defaultValue = "10", dataType = "int", paramType = "query")
    })
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Page<Post>> searchByTimeRange(
            @RequestParam LocalDateTime startTime,
            @RequestParam LocalDateTime endTime,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(postSearchService.searchByTimeRange(startTime, endTime, new Page<>(pageNum, pageSize)));
    }

    /**
     * 获取相似帖子推荐
     *
     * @param postId 帖子ID
     * @param limit 返回的数量，默认为5
     * @return 包含相似帖子列表的ApiResponse对象
     */
    @GetMapping("/es/similar/{postId}")
    @ApiOperation("获取相似帖子推荐")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "postId", value = "帖子ID", required = true, dataType = "Long", paramType = "path"),
            @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "5", dataType = "int", paramType = "query")
    })
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Post>> getSimilarPosts(
            @PathVariable Long postId,
            @RequestParam(defaultValue = "5") int limit) {
        return ApiResponse.success(postSearchService.getSimilarPosts(postId, limit));
    }

    /**
     * 获取热门搜索词
     *
     * @param limit 返回的数量，默认为10
     * @return 包含热门搜索词列表的ApiResponse对象
     */
    @GetMapping("/es/hot-searches")
    @ApiOperation("获取热门搜索词")
    @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getHotSearchWords(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getHotSearchWords(limit));
    }

    /**
     * 获取用户搜索历史
     *
     * @param limit 返回的数量，默认为10
     * @return 包含用户搜索历史的ApiResponse对象
     */
    @GetMapping("/es/search-history")
    @ApiOperation("获取用户搜索历史")
    @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<String>> getSearchHistory(
            @RequestParam(defaultValue = "10") int limit) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postSearchService.getUserSearchHistory(userId, limit));
    }

    /**
     * 获取标签统计信息
     *
     * @return 包含标签统计信息的ApiResponse对象
     */
    @GetMapping("/es/tags/aggregate")
    @ApiOperation("获取标签统计信息")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Long>> aggregateByTags() {
        return ApiResponse.success(postSearchService.aggregateByTags());
    }

    /**
     * 获取搜索建议
     *
     * @param prefix 搜索前缀
     * @return 包含搜索建议列表的ApiResponse对象
     */
    @GetMapping("/es/suggest")
    @ApiOperation("获取搜索建议")
    @ApiImplicitParam(name = "prefix", value = "搜索前缀", required = true, dataType = "String", paramType = "query")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<String>> suggest(@RequestParam String prefix) {
        return ApiResponse.success(postSearchService.suggest(prefix));
    }

    /**
     * 同步帖子到ES
     *
     * @param postId 帖子ID，可选
     * @return 包含同步结果的ApiResponse对象
     */
    @PostMapping("/es/sync")
    @ApiOperation("同步帖子到ES")
    @ApiImplicitParam(name = "postId", value = "帖子ID", required = false, dataType = "Long", paramType = "query")
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

    /**
     * 获取热门话题
     *
     * @param days 天数，默认为7
     * @param limit 返回的数量，默认为10
     * @return 包含热门话题列表的ApiResponse对象
     */
    @GetMapping("/es/hot-topics")
    @ApiOperation("获取热门话题")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "days", value = "天数", defaultValue = "7", dataType = "int", paramType = "query"),
            @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    })
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getHotTopics(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getHotTopics(days, limit));
    }

    /**
     * 获取个性化推荐帖子
     *
     * @param limit 返回的数量，默认为10
     * @return 包含个性化推荐帖子列表的ApiResponse对象
     */
    @GetMapping("/es/recommendations")
    @ApiOperation("获取个性化推荐帖子")
    @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Post>> getPersonalizedRecommendations(
            @RequestParam(defaultValue = "10") int limit) {
        Long userId = AuthContext.getCurrentUser().getId();
        return ApiResponse.success(postSearchService.getPersonalizedRecommendations(userId, limit));
    }

    /**
     * 获取热门地点
     *
     * @param limit 返回的数量，默认为10
     * @return 包含热门地点列表的ApiResponse对象
     */
    @GetMapping("/es/hot-locations")
    @ApiOperation("获取热门地点")
    @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getHotLocations(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getHotLocations(limit));
    }

    /**
     * 获取帖子情感分析
     *
     * @param postId 帖子ID
     * @return 包含情感分析结果的ApiResponse对象
     */
    @GetMapping("/es/sentiment/{postId}")
    @ApiOperation("获取帖子情感分析")
    @ApiImplicitParam(name = "postId", value = "帖子ID", required = true, dataType = "Long", paramType = "path")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> analyzeSentiment(
            @PathVariable Long postId) {
        return ApiResponse.success(postSearchService.analyzeSentiment(postId));
    }

    /**
     * 获取趋势分析
     *
     * @param days 天数，默认为7
     * @return 包含趋势分析数据的ApiResponse对象
     */
    @GetMapping("/es/trends")
    @ApiOperation("获取趋势分析")
    @ApiImplicitParam(name = "days", value = "天数", defaultValue = "7", dataType = "int", paramType = "query")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getTrends(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(postSearchService.getTrends(days));
    }

    /**
     * 获取相似用户推荐
     *
     * @param userId 用户ID
     * @param limit 返回的数量，默认为10
     * @return 包含相似用户列表的ApiResponse对象
     */
    @GetMapping("/es/similar-users/{userId}")
    @ApiOperation("获取相似用户推荐")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "userId", value = "用户ID", required = true, dataType = "Long", paramType = "path"),
            @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    })
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getSimilarUsers(
            @PathVariable Long userId,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getSimilarUsers(userId, limit));
    }

    /**
     * 获取热门发帖时段分布
     *
     * @param days 天数，默认为7
     * @return 包含热门发帖时段分布的ApiResponse对象
     */
    @GetMapping("/es/hot-time-distribution")
    @ApiOperation("获取热门发帖时段分布")
    @ApiImplicitParam(name = "days", value = "天数", defaultValue = "7", dataType = "int", paramType = "query")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Long>> getHotTimeDistribution(
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(postSearchService.getHotTimeDistribution(days));
    }

    /**
     * 获取标签关联分析
     *
     * @param tagName 标签名
     * @param limit 返回的数量，默认为10
     * @return 包含标签关联分析结果的ApiResponse对象
     */
    @GetMapping("/es/tag-relations/{tagName}")
    @ApiOperation("获取标签关联分析")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "tagName", value = "标签名", required = true, dataType = "String", paramType = "path"),
            @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    })
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getTagRelations(
            @PathVariable String tagName,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(postSearchService.getTagRelations(tagName, limit));
    }

    /**
     * 获取帖子内容质量评分
     *
     * @param postId 帖子ID
     * @return 包含内容质量评分结果的ApiResponse对象
     */
    @GetMapping("/es/content-quality/{postId}")
    @ApiOperation("获取帖子内容质量评分")
    @ApiImplicitParam(name = "postId", value = "帖子ID", required = true, dataType = "Long", paramType = "path")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getContentQualityScore(
            @PathVariable Long postId) {
        return ApiResponse.success(postSearchService.getContentQualityScore(postId));
    }
}