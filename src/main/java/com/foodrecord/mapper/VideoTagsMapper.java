package com.foodrecord.mapper;

import com.foodrecord.model.entity.video.VideoTags;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoTagsMapper {

    @Insert("INSERT INTO video_tags (video_id, tag, created_at) VALUES (#{videoId}, #{tag}, NOW())")
    int save(VideoTags videoTag);

    @Delete("DELETE FROM video_tags WHERE video_id = #{videoId} AND tag = #{tag}")
    int delete(@Param("videoId") Long videoId, @Param("tag") String tag);

    @Select("SELECT tag FROM video_tags WHERE video_id = #{videoId}")
    List<String> selectVideoTags(Long videoId);

    @Select("SELECT v.*, COUNT(vt.tag) as tag_count " +
            "FROM videos v " +
            "JOIN video_tags vt ON v.id = vt.video_id " +
            "WHERE vt.tag = #{tag} AND v.is_delete = 0 " +
            "GROUP BY v.id " +
            "ORDER BY v.created_at DESC " +
            "LIMIT #{offset}, #{pageSize}")
    List<Map<String, Object>> selectVideosByTag(@Param("tag") String tag,
                                              @Param("offset") int offset,
                                              @Param("pageSize") int pageSize);

    @Select("SELECT tag, COUNT(*) as count " +
            "FROM video_tags " +
            "GROUP BY tag " +
            "ORDER BY count DESC " +
            "LIMIT #{limit}")
    List<Map<String, Object>> selectPopularTags(Integer limit);
}




