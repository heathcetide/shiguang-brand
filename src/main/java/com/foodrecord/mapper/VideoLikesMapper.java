package com.foodrecord.mapper;

import com.foodrecord.model.entity.video.VideoLikes;
import org.apache.ibatis.annotations.*;

@Mapper
public interface VideoLikesMapper {

    @Insert("INSERT INTO video_likes (video_id, user_id, created_at) " +
            "VALUES (#{videoId}, #{userId}, NOW())")
    int save(VideoLikes videoLike);

    @Delete("DELETE FROM video_likes WHERE video_id = #{videoId} AND user_id = #{userId}")
    int delete(@Param("videoId") Long videoId, @Param("userId") Long userId);

    @Select("SELECT COUNT(*) FROM video_likes WHERE video_id = #{videoId} AND user_id = #{userId}")
    int checkLikeExists(@Param("videoId") Long videoId, @Param("userId") Long userId);

    @Update("UPDATE videos SET likes_count = likes_count + 1 WHERE id = #{videoId}")
    void incrementLikeCount(Long videoId);

    @Update("UPDATE videos SET likes_count = likes_count - 1 WHERE id = #{videoId}")
    void decrementLikeCount(Long videoId);
}




