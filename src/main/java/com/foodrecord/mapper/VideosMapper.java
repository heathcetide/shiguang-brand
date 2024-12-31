package com.foodrecord.mapper;

import com.foodrecord.model.entity.video.Videos;
import org.apache.ibatis.annotations.*;

import java.util.Date;
import java.util.List;
import java.util.Map;

@Mapper
public interface VideosMapper {
    
    @Insert("INSERT INTO videos (user_id, title, description, video_url, thumbnail_url, duration, " +
            "views_count, likes_count, comments_count, created_at, updated_at, is_delete) " +
            "VALUES (#{userId}, #{title}, #{description}, #{videoUrl}, #{thumbnailUrl}, #{duration}, " +
            "#{viewsCount}, #{likesCount}, #{commentsCount}, #{createdAt}, #{updatedAt}, #{isDelete})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int save(Videos video);

    @Select("SELECT v.*, u.username as author_name, u.avatar as author_avatar, " +
            "(SELECT COUNT(*) FROM video_likes WHERE video_id = v.id) as like_count, " +
            "(SELECT COUNT(*) FROM video_comments WHERE video_id = v.id) as comment_count " +
            "FROM videos v " +
            "LEFT JOIN user u ON v.user_id = u.id " +
            "WHERE v.id = #{id} AND v.is_delete = 0")
    Map<String, Object> selectVideoDetails(Long id);

    @Select("SELECT v.*, u.nick_name as author_name, u.avatar as author_avatar " +
            "FROM videos v " +
            "LEFT JOIN user u ON v.user_id = u.id " +
            "WHERE v.is_delete = 0 " +
            "ORDER BY (v.views_count * 0.4 + v.likes_count * 0.3 + v.comments_count * 0.3) DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Map<String, Object>> selectRecommendedVideos(@Param("offset") int offset, 
                                                     @Param("pageSize") int pageSize);

    @Select("SELECT v.*, u.nick_name as author_name, u.avatar as author_avatar " +
            "FROM videos v " +
            "LEFT JOIN user u ON v.user_id = u.id " +
            "WHERE v.is_delete = 0 AND v.id > #{lastVideoId} " +
            "ORDER BY (v.views_count * 0.4 + v.likes_count * 0.3 + v.comments_count * 0.3) DESC " +
            "LIMIT 1")
    Map<String, Object> getNextVideo(@Param("lastVideoId") Long lastVideoId);

    @Select("SELECT v.*, u.username as author_name " +
            "FROM videos v " +
            "LEFT JOIN user u ON v.user_id = u.id " +
            "WHERE v.is_delete = 0 " +
            "AND (v.title LIKE CONCAT('%', #{keyword}, '%') " +
            "OR v.description LIKE CONCAT('%', #{keyword}, '%')) " +
            "ORDER BY v.created_at DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Videos> searchVideos(@Param("keyword") String keyword, 
                            @Param("offset") int offset, 
                            @Param("pageSize") int pageSize);

    @Select("SELECT v.* " +
            "FROM videos v " +
            "JOIN video_tags vt ON v.id = vt.video_id " +
            "WHERE v.is_delete = 0 AND vt.tag = #{tag} " +
            "ORDER BY v.created_at DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Videos> selectVideosByTag(@Param("tag") String tag, 
                                 @Param("offset") int offset, 
                                 @Param("pageSize") int pageSize);

    @Select("SELECT * FROM videos " +
            "WHERE user_id = #{userId} AND is_delete = 0 " +
            "ORDER BY created_at DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Videos> selectUserVideos(@Param("userId") Long userId, 
                                @Param("offset") int offset, 
                                @Param("pageSize") int pageSize);

    @Update("UPDATE videos SET is_delete = 1 " +
            "WHERE id = #{id} AND user_id = #{userId}")
    int deleteVideo(@Param("id") Long id, @Param("userId") Long userId);

    @Update("UPDATE videos SET title = #{title}, description = #{description}, " +
            "thumbnail_url = #{thumbnailUrl}, updated_at = NOW() " +
            "WHERE id = #{id} AND user_id = #{userId} AND is_delete = 0")
    int updateVideo(Videos video);

    @Select("SELECT COUNT(*) FROM videos " +
            "WHERE user_id = #{userId} AND is_delete = 0")
    int countUserVideos(Long userId);

    @Update("UPDATE videos SET views_count = views_count + 1 " +
            "WHERE id = #{id}")
    void incrementViewCount(Long id);

    /**
     * 获取热门视频列表
     */
    @Select("SELECT v.*, u.username as author_name, u.avatar as author_avatar " +
            "FROM videos v " +
            "LEFT JOIN user u ON v.user_id = u.id " +
            "WHERE v.is_delete = 0 " +
            "AND (#{startDate} IS NULL OR v.created_at >= #{startDate}) " +
            "ORDER BY (v.views_count * 0.4 + v.likes_count * 0.3 + v.comments_count * 0.3) DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Videos> selectTrendingVideos(@Param("offset") int offset, 
                                    @Param("pageSize") int pageSize, 
                                    @Param("startDate") Date startDate);

    /**
     * 获取分类热门视频
     */
    @Select("SELECT v.*, u.username as author_name, u.avatar as author_avatar " +
            "FROM videos v " +
            "LEFT JOIN user u ON v.user_id = u.id " +
            "LEFT JOIN video_categories vc ON v.id = vc.video_id " +
            "WHERE v.is_delete = 0 AND vc.category = #{category} " +
            "ORDER BY (v.views_count * 0.4 + v.likes_count * 0.3 + v.comments_count * 0.3) DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Videos> selectTrendingByCategory(@Param("category") String category, 
                                        @Param("offset") int offset, 
                                        @Param("pageSize") int pageSize);

    /**
     * 插入定时发布任务
     */
    @Insert("INSERT INTO video_schedule_tasks (video_id, user_id, schedule_time, status, created_at) " +
            "VALUES (#{videoId}, #{userId}, #{scheduleTime}, 0, NOW())")
    int insertScheduleTask(@Param("videoId") Long videoId, 
                          @Param("userId") Long userId, 
                          @Param("scheduleTime") Date scheduleTime);

    /**
     * 获取用户的定时发布任务列表
     */
    @Select("SELECT vst.*, v.title, v.thumbnail_url, v.duration " +
            "FROM video_schedule_tasks vst " +
            "LEFT JOIN videos v ON vst.video_id = v.id " +
            "WHERE vst.user_id = #{userId} AND vst.status = 0 " +
            "ORDER BY vst.schedule_time ASC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Map<String, Object>> selectScheduledVideos(@Param("userId") Long userId, 
                                                  @Param("offset") int offset, 
                                                  @Param("pageSize") int pageSize);

    /**
     * 删除定时发布任务
     */
    @Update("UPDATE video_schedule_tasks SET status = 2 " +
            "WHERE video_id = #{videoId} AND user_id = #{userId} AND status = 0")
    int deleteScheduleTask(@Param("videoId") Long videoId, @Param("userId") Long userId);

    /**
     * 根据ID查询视频
     */
    @Select("SELECT * FROM videos WHERE id = #{id} AND is_delete = 0")
    Videos selectById(@Param("id") Long id);

    /**
     * 获取待发布的定时任务
     */
    @Select("SELECT * FROM video_schedule_tasks " +
            "WHERE status = 0 AND schedule_time <= NOW()")
    List<Map<String, Object>> selectPendingScheduleTasks();

    /**
     * 更新定时任务状态
     */
    @Update("UPDATE video_schedule_tasks SET status = #{status}, updated_at = NOW() " +
            "WHERE id = #{taskId}")
    int updateScheduleTaskStatus(@Param("taskId") Long taskId, @Param("status") Integer status);

    /**
     * 更新视频发布状态
     */
    @Update("UPDATE videos SET status = #{status}, published_at = NOW() " +
            "WHERE id = #{videoId}")
    int updateVideoPublishStatus(@Param("videoId") Long videoId, @Param("status") Integer status);
}




