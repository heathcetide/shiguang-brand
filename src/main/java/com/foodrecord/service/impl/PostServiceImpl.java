package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.controller.user.UserController;
import com.foodrecord.mapper.PostLikesMapper;
import com.foodrecord.mapper.PostMapper;
import com.foodrecord.mapper.PostFavoritesMapper;
import com.foodrecord.mapper.PostReportMapper;
import com.foodrecord.model.dto.PostDTO;
import com.foodrecord.model.entity.Post;
import com.foodrecord.model.entity.PostLikes;
import com.foodrecord.model.entity.PostFavorites;
import com.foodrecord.model.entity.PostReport;
import com.foodrecord.service.PostService;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import java.util.stream.Collectors;

/**
* @author Lenovo
* @description 针对表【post】的数据库操作Service实现
* @createDate 2024-12-02 21:47:52
*/
@Service
public class PostServiceImpl extends ServiceImpl<PostMapper, Post>
    implements PostService {

    @Resource
    private PostMapper postMapper;

    @Resource
    private PostLikesMapper postLikesMapper;

    @Resource
    private PostFavoritesMapper postFavoritesMapper;

    @Resource
    private PostReportMapper postReportMapper;

    private ObjectMapper objectMapper = new ObjectMapper();

    private static final String POST_LIKE_KEY = "post:like:";
    private static final org.slf4j.Logger logger = LoggerFactory.getLogger(UserController.class);
    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final Logger log = Logger.getLogger(PostServiceImpl.class.getName());

    @Override
    public List<Long> getHotPostIds() {
        try {
            // 从缓存获取热门帖子ID列表
            String cacheKey = "hot_post_ids";
            List<Long> hotPostIds = (List<Long>) redisTemplate.opsForValue().get(cacheKey);
            if (hotPostIds != null) {
                return hotPostIds;
            }

            // 从数据库查询热门帖子
            hotPostIds = postMapper.selectHotPostIds();
            
            // 更新缓存，设置5分钟过期
            if (hotPostIds != null && !hotPostIds.isEmpty()) {
                redisTemplate.opsForValue().set(cacheKey, hotPostIds, 5, TimeUnit.MINUTES);
            }
            
            return hotPostIds != null ? hotPostIds : new ArrayList<>();
        } catch (Exception e) {
            System.out.println("获取热门帖子ID失败"+ e);
            return new ArrayList<>();
        }
    }

    @Override
    public Post selectById(Long postId) {
        return postMapper.selectPostById(postId);
    }

    @Override
    public List<Post> getList() {
        return postMapper.getList();
    }

    @Override
    public Boolean updatePostById(Post post) {
        return postMapper.updatePostById(post);
    }
    @Override
    public Boolean upLikesCountById(Post post) {
        try {
            // 先查询当前帖子
            Post currentPost = postMapper.selectPostById(post.getId());
            if (currentPost == null) {
                return false;
            }
            
            // 确保likesCount不为null
            if (currentPost.getLikesCount() == null) {
                currentPost.setLikesCount(0);
            }
            
            // 设置新的点赞数
            currentPost.setLikesCount(currentPost.getLikesCount() + 1);
            
            return postMapper.upLikesCountById(currentPost);
        } catch (Exception e) {
            System.out.println("更新点赞数失败: " + e.getMessage());
            return false;
        }
    }

    @Override
    public Boolean insert(Post post) {
        return postMapper.save(post);
    }

    @Override
    public Post getPostById(Long postId) {
        return postMapper.selectPostById(postId);
    }

    @Override
    public Boolean downLikesCountById(Post post) {
        try {
            // 先查询当前帖子
            Post currentPost = postMapper.selectPostById(post.getId());
            if (currentPost == null) {
                return false;
            }
            
            // 确保likesCount不为null且大于0
            if (currentPost.getLikesCount() == null) {
                currentPost.setLikesCount(0);
            } else if (currentPost.getLikesCount() > 0) {
                // 设置新的点赞数
                currentPost.setLikesCount(currentPost.getLikesCount() - 1);
            }
            
            return postMapper.upLikesCountById(currentPost);
        } catch (Exception e) {
            System.out.println("更新点赞数失败: " + e.getMessage());
            return false;
        }
    }

    @Override
    @Transactional
    public boolean saveAll(List<Post> posts) {
        for (Post post : posts) {
            post.setContent(cleanContent(post.getContent()));
            post.setUserId(1L);
            postMapper.save(post);
        }
        return true;
    }

    private String cleanContent(String content) {
        // 去除 HTML 标签
        String noHtmlContent = content.replaceAll("<[^>]*>", "");

        // 去除 Markdown 格式
        String noMarkdownContent = noHtmlContent.replaceAll("\\[.*?\\]\\(.*?\\)", "");

        // 其他特殊字符处理
        String safeContent = noMarkdownContent.replace("'", "''"); // 双引号闭合

        return safeContent;
    }

    @Override
    public Page<Post> getPosts(int pageNum, int pageSize, String sortBy) {
        Page<Post> page = new Page<>(pageNum, pageSize);
        QueryWrapper<Post> queryWrapper = new QueryWrapper<Post>()
                .eq("is_delete", 0);

        if ("hot".equals(sortBy)) {
            queryWrapper.orderByDesc("likes_count", "comments_count");
        } else {
            queryWrapper.orderByDesc("created_at");
        }

        return postMapper.selectPage(page, queryWrapper);
    }

    @Override
    public Post getPostDetail(Long postId) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        return post;
    }

    @Override
    @Transactional
    public Post createPost(Long userId, PostDTO postDTO) {
        try {
            Post post = new Post();
            post.setUserId(userId);
            post.setContent(postDTO.getContent());
            post.setMediaUrl(postDTO.getMediaUrl());
            post.setTags(objectMapper.writeValueAsString(postDTO.getTags()));
            postMapper.insert(post);
            return post;
        }catch (Exception e){
            return null;
        }
    }
    @Override
    @Transactional
    public Post updatePost(Long userId, Long postId, PostDTO postDTO) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        if (!post.getUserId().equals(userId)) {
            throw new CustomException("无权修改此帖子");
        }
        try {
            post.setContent(postDTO.getContent());
            post.setMediaUrl(postDTO.getMediaUrl());
            post.setTags(objectMapper.writeValueAsString(postDTO.getTags()));

            postMapper.updateById(post);
            return post;
        }catch (Exception e){
            return null;
        }
    }

    @Override
    @Transactional
    public void deletePost(Long userId, Long postId) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        if (!post.getUserId().equals(userId)) {
            throw new CustomException("无权删除此帖子");
        }

        post.setIsDelete(1);
        postMapper.updateById(post);
    }

    @Override
    @Transactional
    public Boolean likePost(Long userId, Long postId) {
        String likeKey = POST_LIKE_KEY + postId + ":" + userId;

        // 先检查Redis缓存
        if (Boolean.TRUE.equals(redisTemplate.hasKey(likeKey))) {
            return false;
        }

        // 再检查数据库
        if (postLikesMapper.existsPost(postId, userId)) {
            // 同步缓存
            redisTemplate.opsForValue().set(likeKey, true, 24, TimeUnit.HOURS);
            return false;
        }

        try {
            // 添加点赞记录
            PostLikes like = new PostLikes();
            like.setPostId(postId);
            like.setUserId(userId);
            postLikesMapper.insert(like);

            // 更新帖子点赞数
            postMapper.increaseLikesCount(postId);

            // 更新缓存
            redisTemplate.opsForValue().set(likeKey, true, 24, TimeUnit.HOURS);

            return true;
        } catch (DuplicateKeyException e) {
            // 处理并发情况下的重复点赞
            logger.warn("用户 {} 重复点赞帖子 {}", userId, postId);
            return false;
        }
    }

    @Override
    @Transactional
    public Boolean unlikePost(Long userId, Long postId) {
        String likeKey = POST_LIKE_KEY + postId + ":" + userId;

        // 先检查Redis缓存
        if (Boolean.FALSE.equals(redisTemplate.hasKey(likeKey))) {
            return false;
        }

        try {
            // 删除点赞记录
            if (postLikesMapper.deletePost(postId, userId) > 0) {
                // 更新帖子点赞数
                postMapper.decreaseLikesCount(postId);

                // 删除缓存
                redisTemplate.delete(likeKey);

                return true;
            }
            return false;
        } catch (Exception e) {
            logger.error("取消点赞失败", e);
            return false;
        }
    }

    @Override
    public Page<Post> getUserPosts(Long userId, int pageNum, int pageSize) {
        Page<Post> page = new Page<>(pageNum, pageSize);
        return postMapper.selectPage(page,
                new QueryWrapper<Post>()
                        .eq("user_id", userId)
                        .eq("is_delete", 0)
                        .orderByDesc("created_at"));
    }

    @Override
    public List<Post> getTrendingPosts(int limit) {
        return postMapper.selectList(
                new QueryWrapper<Post>()
                        .eq("is_delete", 0)
                        .orderByDesc("likes_count", "comments_count")
                        .last("LIMIT " + limit));
    }

    @Override
    public Page<Post> searchPosts(String keyword, int pageNum, int pageSize) {
        Page<Post> page = new Page<>(pageNum, pageSize);
        return postMapper.selectPage(page,
                new QueryWrapper<Post>()
                        .eq("is_delete", 0)
                        .like("content", keyword)
                        .orderByDesc("created_at"));
    }

    @Override
    public Page<Post> getPostsByTag(String tag, int pageNum, int pageSize) {
        Page<Post> page = new Page<>(pageNum, pageSize);
        return postMapper.selectPage(page,
                new QueryWrapper<Post>()
                        .eq("is_delete", 0)
                        .like("tags", tag)
                        .orderByDesc("created_at"));
    }

    @Override
    public List<String> getPopularTags(int limit) {
        // 获取所有未删除帖子的标签
        List<String> allTags = postMapper.selectList(
                        new QueryWrapper<Post>()
                                .eq("is_delete", 0)
                                .isNotNull("tags")
                ).stream()
                .map(post -> {
                    try {
                        return objectMapper.readValue(post.getTags(), String.class);
                    } catch (JsonProcessingException e) {
                        throw new RuntimeException(e);
                    }
                })
//                .flatMap(List::stream)
                .collect(Collectors.toList());

        // 统计标签出现次数并返回前limit个
        return allTags.stream()
                .collect(Collectors.groupingBy(tag -> tag, Collectors.counting()))
                .entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(limit)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    @Override
    @Transactional
    public Boolean favoritePost(Long userId, Long postId) {
        // 检查帖子是否存在
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }

        // 检查是否已经收藏
        if (postFavoritesMapper.exists(postId, userId)) {
            return false;
        }

        // 创建收藏记录
        PostFavorites favorite = new PostFavorites();
        favorite.setPostId(postId);
        favorite.setUserId(userId);
        
        return postFavoritesMapper.insert(favorite) > 0;
    }

    @Override
    @Transactional
    public Boolean unfavoritePost(Long userId, Long postId) {
        return postFavoritesMapper.delete(postId, userId) > 0;
    }

    @Override
    public Page<Post> getFavoritePosts(Long userId, int pageNum, int pageSize) {
        Page<Post> page = new Page<>(pageNum, pageSize);
        return postMapper.selectFavoritePostsByUserId(page, userId);
    }

    @Override
    @Transactional
    public Boolean reportPost(Long userId, Long postId, String reason) {
        // 检查帖子是否存在
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }

        // 检查是否已经举报
        if (postReportMapper.exists(postId, userId)) {
            throw new CustomException("您已经举报过该帖子");
        }

        // 创建举报记录
        PostReport report = new PostReport();
        report.setPostId(postId);
        report.setUserId(userId);
        report.setReason(reason);
        report.setStatus("PENDING");

        return postReportMapper.insert(report) > 0;
    }

    @Override
    public Map<String, Object> getUserPostStatistics(Long userId) {
        Map<String, Object> statistics = new HashMap<>();
        
        // 获取用户发帖总数
        long totalPosts = postMapper.selectCount(
            new QueryWrapper<Post>()
                .eq("user_id", userId)
                .eq("is_delete", 0)
        );
        
        // 获取用户获赞总数
        long totalLikes = postMapper.sumLikesByUserId(userId);
        
        // 获取用户帖子被收藏总数
        long totalFavorites = postMapper.sumFavoritesByUserId(userId);
        
        // 获取用户最近7天的发帖数量
        List<Map<String, Object>> dailyPosts = postMapper.countPostsByDateRange(
            userId, 
            LocalDateTime.now().minusDays(7),
            LocalDateTime.now()
        );
        
        statistics.put("totalPosts", totalPosts);
        statistics.put("totalLikes", totalLikes);
        statistics.put("totalFavorites", totalFavorites);
        statistics.put("dailyPosts", dailyPosts);
        
        return statistics;
    }

    @Override
    @Transactional
    public Boolean pinPost(Long postId) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        
//        post.setIsPinned(1);
        return postMapper.updateById(post) > 0;
    }

    @Override
    @Transactional
    public Boolean unpinPost(Long postId) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        
//        post.setIsPinned(0);
        return postMapper.updateById(post) > 0;
    }

    @Override
    @Transactional
    public void adminDeletePost(Long postId) {
        // 1. 删除帖子
        Post post = postMapper.selectById(postId);
        if (post == null) {
            throw new CustomException("帖子不存在");
        }
        post.setIsDelete(1);
        postMapper.updateById(post);

        // 2. 删除相关的点赞记录
        postLikesMapper.deleteByPostId(postId);

        // 3. 删除相关的收藏记录
        postFavoritesMapper.deleteByPostId(postId);

        // 4. 删除相关的举报记录
        postReportMapper.deleteByPostId(postId);
    }

    @Override
    public Page<Map<String, Object>> getPostReports(int pageNum, int pageSize) {
        Page<Map<String, Object>> page = new Page<>(pageNum, pageSize);
        
        // 获取举报记录
        List<Map<String, Object>> reports = postReportMapper.selectReportsWithDetails(page);
        
        // 设置总记录数
        Long total = postReportMapper.countReports();
        page.setTotal(total);
        page.setRecords(reports);
        
        return page;
    }

    @Override
    @Transactional
    public Boolean handlePostReport(Long reportId, String action, String feedback) {
        PostReport report = postReportMapper.selectById(reportId);
        if (report == null) {
            throw new CustomException("举报记录不存在");
        }

        // 更新举报状态
        report.setStatus(action);
        report.setFeedback(feedback);
//        report.setHandleTime(LocalDateTime.now());
        postReportMapper.updateById(report);

        // 如果是删除帖子的操作
        if ("DELETE".equals(action)) {
            Post post = postMapper.selectById(report.getPostId());
            if (post != null) {
                post.setIsDelete(1);
                postMapper.updateById(post);
            }
        }

        return true;
    }

    @Override
    public Map<String, Object> getPostsOverview() {
        Map<String, Object> overview = new HashMap<>();
        
        // 获取总帖子数
        overview.put("totalPosts", postMapper.countActivePosts());
        
        // 获取今日新增帖子数
        overview.put("todayNewPosts", postMapper.countTodayPosts());
        
        // 获取待审核帖子数
        overview.put("pendingAuditPosts", postMapper.countPendingAuditPosts());
        
        // 获取被举报帖子数
        overview.put("reportedPosts", postMapper.countReportedPosts());
        
        // 获取热门帖子数据
        overview.put("hotPosts", postMapper.selectHotPosts(5));
        
        return overview;
    }

    @Override
    public List<Map<String, Object>> getDailyPostStatistics(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return postMapper.selectDailyStatistics(startTime);
    }

    @Override
    public List<Map<String, Object>> getUserPostRanking(int limit) {
        return postMapper.selectUserPostRanking(limit);
    }

    @Override
    @Transactional
    public void recommendPost(Long postId, int days) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        
        // 设置推荐结束时间
//        post.setRecommendEndTime(LocalDateTime.now().plusDays(days));
//        post.setIsRecommend(1);
        
        postMapper.updateById(post);
    }

    @Override
    public List<Map<String, Object>> getCategoryStatistics() {
        return postMapper.selectCategoryStatistics();
    }

    @Override
    public List<Map<String, Object>> getHotPostsAnalysis(int days, int limit) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return postMapper.selectHotPostsAnalysis(startTime, limit);
    }

    @Override
    public Map<String, Object> getInteractionAnalysis(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        
        Map<String, Object> analysis = new HashMap<>();
        
        // 获取互动总量
//        analysis.put("totalInteractions", postMapper.countTotalInteractions(startTime));
        
        // 获取每日互动趋势
//        analysis.put("dailyTrends", postMapper.selectDailyInteractions(startTime));
        
        // 获取互动类型分布
//        analysis.put("typeDistribution", postMapper.selectInteractionTypeDistribution(startTime));
        
        // 获取高互动时段分布
//        analysis.put("timeDistribution", postMapper.selectInteractionTimeDistribution(startTime));
        
        return analysis;
    }

    @Override
    @Transactional
    public void highlightPost(Long postId) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        
//        post.setIsHighlight(1);
        postMapper.updateById(post);
    }

    @Override
    @Transactional
    public void unhighlightPost(Long postId) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        
//        post.setIsHighlight(0);
        postMapper.updateById(post);
    }

    @Override
    public Page<Post> getAuditPosts(int pageNum, int pageSize) {
        Page<Post> page = new Page<>(pageNum, pageSize);
        return postMapper.selectPage(page,
                new QueryWrapper<Post>()
                        .eq("is_delete", 0)
                        .eq("status", "PENDING")
                        .orderByDesc("created_at"));
    }

    @Override
    @Transactional
    public Boolean auditPost(Long postId, String action, String reason) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        
        if ("APPROVE".equals(action)) {
//            post.setStatus("APPROVED");
        } else if ("REJECT".equals(action)) {
//            post.setStatus("REJECTED");
//            post.setRejectReason(reason);
        } else {
            throw new CustomException("无效的审核操作");
        }
        
//        post.setAuditTime(LocalDateTime.now());
        return postMapper.updateById(post) > 0;
    }

    @Override
    @Transactional
    public void moveCategory(Long postId, String targetCategory) {
        Post post = postMapper.selectById(postId);
        if (post == null || post.getIsDelete() == 1) {
            throw new CustomException("帖子不存在");
        }
        
//        post.setCategory(targetCategory);
        postMapper.updateById(post);
    }
}




