package com.foodrecord.mapper;

import com.foodrecord.model.entity.video.Videos;
import org.apache.ibatis.annotations.*;

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
}




