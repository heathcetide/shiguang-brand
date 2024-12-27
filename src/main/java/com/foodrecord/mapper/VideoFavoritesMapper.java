package com.foodrecord.mapper;

import com.foodrecord.model.entity.video.VideoFavorites;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoFavoritesMapper {

    @Insert("INSERT INTO video_favorites (video_id, user_id, created_at) " +
            "VALUES (#{videoId}, #{userId}, NOW())")
    int save(VideoFavorites favorite);

    @Delete("DELETE FROM video_favorites WHERE video_id = #{videoId} AND user_id = #{userId}")
    int delete(@Param("videoId") Long videoId, @Param("userId") Long userId);

    @Select("SELECT COUNT(*) FROM video_favorites WHERE video_id = #{videoId} AND user_id = #{userId}")
    int checkFavoriteExists(@Param("videoId") Long videoId, @Param("userId") Long userId);

    @Select("SELECT v.*, u.username as author_name " +
            "FROM videos v " +
            "JOIN video_favorites vf ON v.id = vf.video_id " +
            "LEFT JOIN user u ON v.user_id = u.id " +
            "WHERE vf.user_id = #{userId} AND v.is_delete = 0 " +
            "ORDER BY vf.created_at DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Map<String, Object>> selectUserFavorites(@Param("userId") Long userId,
                                                @Param("offset") int offset,
                                                @Param("pageSize") int pageSize);
}




