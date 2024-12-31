package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Comment;
import org.apache.ibatis.annotations.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【comment】的数据库操作Mapper
* @createDate 2024-12-02 21:47:52
* @Entity com.cetide.cecomment.model.entity.Comment
*/
@Mapper
public interface CommentMapper extends BaseMapper<Comment> {

    @Select("select * from comment where post_id = ${postId}")
    List<Comment> getListByPostId(String postId);

    @Select("select id from comment")
    List<Long> getAllPostIds();

    @Insert("insert into comment (post_id, user_id, content, parent_id) value (#{postId}, #{userId}, #{content}, #{parentId})")
    boolean save(Comment comment);

    @Delete("delete from comment where id = #{id}")
    boolean removeById(Long id);

    @Select("select * from comment where id = #{id}")
    Comment getById(Long id);

    @Select("select * from comment")
    List<Comment> getCommentList();

    /**
     * 批量查询评论的自定义SQL
     */
    @Select("SELECT * FROM comment WHERE post_id = #{postId} ORDER BY created_at DESC LIMIT 1000")
    @Results({
            @Result(column = "id", property = "id"),
            @Result(column = "user_id", property = "userId"),
            @Result(column = "content", property = "content"),
            @Result(column = "post_id", property = "postId"),
            @Result(column = "parent_id", property = "parentId"),
            @Result(column = "created_at", property = "createdAt"),
            @Result(column = "updated_at", property = "updatedAt"),
            @Result(column = "status", property = "status")
    })
    List<Comment> selectBatchByPostId(@Param("postId") String postId);

    /**
     * 查询评论数量的自定义SQL
     */
    @Select("SELECT COUNT(*) FROM comment WHERE post_id = #{postId}")
    Long selectCommentCount(@Param("postId") String postId);

    @Update("UPDATE comment SET content = #{content}, updated_at = NOW() WHERE id = #{id}")
    boolean updateComment(@Param("id") Long id, @Param("content") String content);

    /**
     * 获取每日评论统计
     */
    List<Map<String, Object>> getDailyStatistics(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取用户评论排行
     */
    List<Map<String, Object>> getUserCommentRanking(@Param("limit") int limit);

    /**
     * 获取评论互动分析
     */
    Map<String, Object> getInteractionAnalysis(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取评论质量分析
     */
    Map<String, Object> getQualityAnalysis();

    /**
     * 获取用户评论行为分析
     */
    List<Map<String, Object>> getUserBehaviorAnalysis(@Param("startTime") LocalDateTime startTime, @Param("limit") int limit);

    /**
     * 获取评论关键词分析
     */
    List<Map<String, Object>> getKeywordAnalysis(@Param("startTime") LocalDateTime startTime, @Param("limit") int limit);

    /**
     * 获取评论情感分析
     */
    Map<String, Object> getSentimentAnalysis(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取评论时间分布
     */
    Map<String, Object> getTimeDistribution(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取评论违规统计
     */
    Map<String, Object> getViolationStatistics(@Param("startTime") LocalDateTime startTime);
}




