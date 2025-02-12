package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.PostDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.Post;

import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【post】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface PostService extends IService<Post> {

    /**
     * 获取热门帖子ID列表
     * 根据点赞数、评论数等指标来判断热门帖子
     * @return 热门帖子ID列表
     */
    List<Long> getHotPostIds();

    Post selectById(Long postId);

    List<Post> getList();

    Boolean updatePostById(Post post);

    Boolean insert(Post post);

    Post getPostById(Long postId);

    Boolean upLikesCountById(Post post);

    Boolean downLikesCountById(Post post);

    boolean saveAll(List<Post> postList);

    Page<Post> getPosts(Page<Post> page, String keyword);

    Post getPostDetail(Long postId);

    Post createPost(Long userId, PostDTO postDTO);

    Post updatePost(Long userId, Long postId, PostDTO postDTO);

    void deletePost(Long userId, Long postId);

    Boolean likePost(Long userId, Long postId);

    Boolean unlikePost(Long userId, Long postId);

    Page<Post> getUserPosts(Long userId, int pageNum, int pageSize);

    List<Post> getTrendingPosts(int limit);

    Page<Post> searchPosts(String keyword, int pageNum, int pageSize);

    Page<Post> getPostsByTag(String tag, int pageNum, int pageSize);

    List<String> getPopularTags(int limit);

    Boolean favoritePost(Long userId, Long postId);

    Boolean unfavoritePost(Long userId, Long postId);

    Page<Post> getFavoritePosts(Long userId, int pageNum, int pageSize);

    Boolean reportPost(Long userId, Long postId, String reason);

    Map<String, Object> getUserPostStatistics(Long userId);

    Boolean pinPost(Long postId);

    Boolean unpinPost(Long postId);

    /**
     * 管理员删除帖子
     */
    void adminDeletePost(Long postId);

    /**
     * 获取帖子举报列表
     */
    Page<Map<String, Object>> getPostReports(int pageNum, int pageSize);

    /**
     * 处理帖子举报
     */
    Boolean handlePostReport(Long reportId, String action, String feedback);

    /**
     * 获取帖子总体统计信息
     */
    Map<String, Object> getPostsOverview();

    /**
     * 获取每日帖子统计
     */
    List<Map<String, Object>> getDailyPostStatistics(int days);

    /**
     * 获取用户发帖排行
     */
    List<Map<String, Object>> getUserPostRanking(int limit);

    /**
     * 推荐帖子
     */
    void recommendPost(Long postId, int days);

    /**
     * 获取分类统计信息
     */
    List<Map<String, Object>> getCategoryStatistics();

    /**
     * 获取热门帖子分析
     */
    List<Map<String, Object>> getHotPostsAnalysis(int days, int limit);

    /**
     * 获取帖子互动分析
     */
    Map<String, Object> getInteractionAnalysis(int days);

    /**
     * 设置精选帖子
     */
    void highlightPost(Long postId);

    /**
     * 取消精选帖子
     */
    void unhighlightPost(Long postId);

    /**
     * 获取待审核帖子列表
     */
    Page<Post> getAuditPosts(int pageNum, int pageSize);

    /**
     * 审核帖子
     */
    Boolean auditPost(Long postId, String action, String reason);

    /**
     * 移动帖子分类
     */
    void moveCategory(Long postId, String targetCategory);

    List<Post> userPosts(int uid, int start, int stop);

    /**
     * 获取帖子总数
     * @return 帖子总数
     */
    long getTotalCount();

}
