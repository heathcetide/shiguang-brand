package com.foodrecord.mapper;

import com.foodrecord.model.entity.video.VideoComments;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoCommentsMapper {

    @Insert("INSERT INTO video_comments (video_id, user_id, content, parent_id, created_at, updated_at) " +
            "VALUES (#{videoId}, #{userId}, #{content}, #{parentId}, #{createdAt}, #{updatedAt})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int save(VideoComments comment);

    @Select("SELECT vc.*, u.username, u.avatar, " +
            "(SELECT username FROM user WHERE id = p.user_id) as parent_username " +
            "FROM video_comments vc " +
            "LEFT JOIN user u ON vc.user_id = u.id " +
            "LEFT JOIN video_comments p ON vc.parent_id = p.id " +
            "WHERE vc.video_id = #{videoId} " +
            "ORDER BY vc.created_at DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Map<String, Object>> selectVideoComments(@Param("videoId") Long videoId,
                                                @Param("offset") int offset,
                                                @Param("pageSize") int pageSize);

    @Delete("DELETE FROM video_comments WHERE id = #{id} AND user_id = #{userId}")
    int deleteComment(@Param("id") Long id, @Param("userId") Long userId);

    @Update("UPDATE video_comments SET content = #{content}, updated_at = NOW() " +
            "WHERE id = #{id} AND user_id = #{userId}")
    int updateComment(VideoComments comment);

    @Select("SELECT COUNT(*) FROM video_comments WHERE video_id = #{videoId}")
    int countVideoComments(Long videoId);

    @Select("SELECT * FROM video_comments WHERE id = #{id}")
    VideoComments selectById(Long id);
}




