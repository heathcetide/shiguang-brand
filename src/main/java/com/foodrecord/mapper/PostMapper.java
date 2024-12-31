package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.Post;
import org.apache.ibatis.annotations.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【post】的数据库操作Mapper
* @createDate 2024-12-02 21:47:52
* @Entity com.cetide.cecomment.model.entity.Post
*/
@Mapper
public interface PostMapper extends BaseMapper<Post> {

    /**
     * 获取热门帖子ID列表
     * 根据点赞数和评论数综合排序
     */
    @Select("SELECT id FROM post " +
            "WHERE is_delete = 0 " +
            "ORDER BY (likes_count * 0.6 + comments_count * 0.4) DESC " +
            "LIMIT 20")
    List<Long> selectHotPostIds();

    @Select("SELECT *, " +
            "COALESCE(likes_count, 0) as likes_count, " +
            "COALESCE(comments_count, 0) as comments_count, " +
            "created_at, updated_at, is_delete " +
            "FROM post WHERE id = #{postId}")
    @Results({
            @Result(column = "id", property = "id"),
            @Result(column = "user_id", property = "userId"),
            @Result(column = "content", property = "content"),
            @Result(column = "media_url", property = "mediaUrl"),
            @Result(column = "tags", property = "tags"),
            @Result(column = "likes_count", property = "likesCount"),
            @Result(column = "comments_count", property = "commentsCount"),
            @Result(column = "created_at", property = "createdAt"),
            @Result(column = "updated_at", property = "updatedAt"),
            @Result(column = "is_delete", property = "isDelete")
    })
    Post selectPostById(Long postId);

    @Select("select * from post")
    @Results({
            @Result(column = "id", property = "id"),
            @Result(column = "user_id", property = "userId"),
            @Result(column = "content", property = "content"),
            @Result(column = "media_url", property = "mediaUrl"),
            @Result(column = "tags", property = "tags"),
            @Result(column = "likes_count", property = "likesCount"),
            @Result(column = "comments_count", property = "commentsCount"),
            @Result(column = "created_at", property = "createdAt"),
            @Result(column = "updated_at", property = "updatedAt"),
            @Result(column = "is_delete", property = "isDelete")
    })
    List<Post> getList();

    @Update("UPDATE post SET content = #{content}, media_url = #{mediaUrl}, tags = #{tags},is_delete = #{isDelete}, updated_at = NOW() " +
            "WHERE id = #{id}")
    boolean updatePostById(Post post);

    @Insert("insert into post (user_id, content, media_url, tags, created_at, updated_at, is_delete) values (#{userId}, #{content}, #{mediaUrl}, #{tags}, #{createdAt}, #{updatedAt}, #{isDelete})")
    boolean save(Post post);

    @Update("UPDATE post SET likes_count = #{likesCount}, updated_at = NOW() WHERE id = #{id}")
    Boolean upLikesCountById(Post post);

    /**
     * 增加帖子点赞数
     */
    @Update("UPDATE post SET likes_count = likes_count + 1 WHERE id = #{postId}")
    void increaseLikesCount(@Param("postId") Long postId);

    /**
     * 减少帖子点赞数
     */
    @Update("UPDATE post SET likes_count = likes_count - 1 WHERE id = #{postId}")
    void decreaseLikesCount(@Param("postId") Long postId);

    /**
     * 增加帖子评论数
     */
    @Update("UPDATE post SET comments_count = comments_count + 1 WHERE id = #{postId}")
    void increaseCommentsCount(@Param("postId") Long postId);

    /**
     * 减少帖子评论数
     */
    @Update("UPDATE post SET comments_count = comments_count - 1 WHERE id = #{postId}")
    void decreaseCommentsCount(@Param("postId") Long postId);

    Page<Post> selectFavoritePostsByUserId(Page<Post> page, @Param("userId") Long userId);
    
    long sumLikesByUserId(@Param("userId") Long userId);
    
    long sumFavoritesByUserId(@Param("userId") Long userId);
    
    List<Map<String, Object>> countPostsByDateRange(
            @Param("userId") Long userId,
            @Param("startDate") LocalDateTime startDate,
            @Param("endDate") LocalDateTime endDate
    );

    /**
     * 统计活跃帖子数量
     */
    Long countActivePosts();

    /**
     * 统计今日新增帖子数
     */
    Long countTodayPosts();

    /**
     * 统计待审核帖子数
     */
    Long countPendingAuditPosts();

    /**
     * 统计被举报帖子数
     */
    Long countReportedPosts();

    /**
     * 获取热门帖子
     */
    List<Map<String, Object>> selectHotPosts(@Param("limit") int limit);

    /**
     * 获取每日帖子统计
     */
    List<Map<String, Object>> selectDailyStatistics(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取用户发帖排行
     */
    List<Map<String, Object>> selectUserPostRanking(@Param("limit") int limit);

    /**
     * 获取分类统计
     */
    List<Map<String, Object>> selectCategoryStatistics();

    /**
     * 获取热门帖子分析
     */
    List<Map<String, Object>> selectHotPostsAnalysis(@Param("startTime") LocalDateTime startTime, @Param("limit") int limit);
}




